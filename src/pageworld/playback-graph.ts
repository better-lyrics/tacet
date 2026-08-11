// -- Playback graph ----------------------------------------------------------

import { decideCrossfade, judgeIncomingStems } from "@/automix/crossfade-gate";
import type { OutgoingSource } from "@/automix/crossfade-gate";
import { chooseOutgoingSource } from "@/automix/fade-plan";
import { CROSSFADE_CURVE_STEPS, equalPowerCurve } from "@/automix/transition";
import { createBypassController } from "@/pageworld/bypass";
import { createDeck } from "@/pageworld/deck";
import { listenerGain } from "@/pageworld/gain-law";
import { playerCurrentTime } from "@/pageworld/player-state";
import { resolveStemStart } from "@/pageworld/stem-offset";
import { shouldRestartStems } from "@/pageworld/stem-restart";
import type { Deck, DeckLoad, DeckState } from "@/pageworld/deck";
import type { StemStart } from "@/pageworld/stem-offset";
import { createLogger } from "@/shared/logger";

const logger = createLogger("page");

const PAUSE_SETTLE_MS = 600;
const PAUSE_CHECK_ATTEMPTS = 20;

interface PlaybackGraphDeps {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  playerTrackId(): string | null;
  ownAdvanceLanding(): boolean;
  ownAdvanceRecent(): boolean;
  onCrossfadeAborted?(videoId: string | null, reason: string): void;
}

interface CrossfadeTiming {
  durationSeconds: number;
  incomingOffsetSeconds?: number;
  startInSeconds?: number;
  videoId?: string;
}

interface StemsCrossfadeRequest extends CrossfadeTiming {
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  mix?: undefined;
}

interface MixCrossfadeRequest extends CrossfadeTiming {
  mix: AudioBuffer;
  vocals?: undefined;
  instrumental?: undefined;
  sampleRate?: undefined;
}

type CrossfadeRequest = StemsCrossfadeRequest | MixCrossfadeRequest;

type CrossfadeResult =
  | { kind: "scheduled"; startsAt: number; endsAt: number; outgoing: "deck" | "original" }
  | { kind: "refused"; reason: string };

interface GraphState {
  engaged: boolean;
  vocalsGain: number;
  instrumentalGain: number;
  originalGain: number;
  contextSampleRate: number;
  stemsLoaded: boolean;
  stemFrames: number;
  stemSampleRate: number;
  vocalsRms: number;
  instrumentalRms: number;
  combinedPeak: number;
  stemsPlaying: boolean;
  elementTime: number;
  playerTime: number;
  startOffset: number | null;
  startSource: string | null;
  startRefusedBecause: string | null;
  listenerGain: number;
  activeDeck: 0 | 1;
  crossfading: boolean;
  outgoingSource: OutgoingSource;
  decks: [DeckState, DeckState];
}

interface PlaybackGraph {
  loadStems(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number,
    trackId: string | null
  ): void;
  loadMix(mix: AudioBuffer, trackId: string | null): void;
  setMixLevel(mixLevel: number): void;
  stopStems(): void;
  resumeStems(): void;
  crossfadeTo(request: CrossfadeRequest): CrossfadeResult;
  abortCrossfade(reason: string): boolean;
  suppressDriftFor(seconds: number): void;
  recoverIfStopped(): boolean;
  recordOutput(seconds: number): Promise<{ samples: Float32Array; sampleRate: number }>;
  isEngaged(): boolean;
  dispose(): void;
  describe(): GraphState;
}

function deckLoadFor(request: CrossfadeRequest): DeckLoad {
  const trackId = request.videoId ?? null;
  if (request.mix !== undefined) return { kind: "mix", mix: request.mix, trackId };
  return {
    kind: "stems",
    vocals: request.vocals,
    instrumental: request.instrumental,
    sampleRate: request.sampleRate,
    trackId,
  };
}

function createPlaybackGraph(deps: PlaybackGraphDeps): PlaybackGraph {
  const { context, source } = deps;

  // -- Stem path: the deck, then the listener's own volume, then out ----------

  const masterNode = context.createGain();
  masterNode.connect(context.destination);

  const listenerVolumeNode = context.createGain();
  listenerVolumeNode.connect(masterNode);

  const decks: [Deck, Deck] = [
    createDeck({ context, output: listenerVolumeNode, onFinished: () => onDeckFinished(0) }),
    createDeck({ context, output: listenerVolumeNode, onFinished: () => onDeckFinished(1) }),
  ];
  let activeDeck: 0 | 1 = 0;
  let crossfade: {
    outgoingDeck: 0 | 1;
    outgoingFrom: "deck" | "original";
    endsAtContextTime: number;
    videoId: string | null;
  } | null = null;
  decks[1].setGain(0);

  const deck = (): Deck => decks[activeDeck];
  const idleDeck = (): Deck => decks[activeDeck === 0 ? 1 : 0];
  const isCrossfading = (): boolean => crossfade !== null && context.currentTime < crossfade.endsAtContextTime;

  const originalGainNode = context.createGain();
  source.disconnect(context.destination);
  source.connect(originalGainNode);
  originalGainNode.connect(masterNode);

  function setOriginalGain(value: number): void {
    originalGainNode.gain.cancelScheduledValues(context.currentTime);
    originalGainNode.gain.value = value;
  }

  function rampOriginalOut(startsAt: number, durationSeconds: number): void {
    originalGainNode.gain.cancelScheduledValues(context.currentTime);
    originalGainNode.gain.setValueCurveAtTime(equalPowerCurve(CROSSFADE_CURVE_STEPS, "out"), startsAt, durationSeconds);
  }

  const originalGainNow = (): number => originalGainNode.gain.value;
  setOriginalGain(1);

  let currentMixLevel = 1;
  let transportAttached = false;
  let lastStart: StemStart | null = null;
  let driftSuppressedUntilContextTime = 0;

  const element = source.mediaElement;

  function syncListenerVolume(): void {
    listenerVolumeNode.gain.value = listenerGain(element.volume, element.muted);
  }
  syncListenerVolume();
  element.addEventListener("volumechange", syncListenerVolume);

  const bypass = createBypassController({
    restoreOriginal() {
      setOriginalGain(1);
    },
    stopStems() {
      deck().stop();
    },
  });

  function handBackToOriginal(reason: string): boolean {
    if (originalGainNow() === 1) return false;
    logger.warn(`handing back to the original, ${reason}`);
    setOriginalGain(1);
    return true;
  }

  function onDeckFinished(index: 0 | 1): void {
    if (index !== activeDeck || isCrossfading() || bypass.isBypassed()) return;
    handBackToOriginal("the deck reached the end of its audio before the track did");
  }

  function silenceOriginalIfTheElementMovesOn(durationSeconds: number): void {
    const onEmptied = (): void => {
      element.removeEventListener("emptied", onEmptied);
      if (!isCrossfading()) return;
      setOriginalGain(0);
      logger.log("the element moved to the next track mid fade, silencing the original rather than doubling it");
    };
    element.addEventListener("emptied", onEmptied);
    setTimeout(() => element.removeEventListener("emptied", onEmptied), (durationSeconds + 1) * 1000);
  }

  function outgoingSource(): OutgoingSource {
    return chooseOutgoingSource({
      bypassed: bypass.isBypassed(),
      deckPlaying: deck().isPlaying(),
      elementPaused: element.paused,
      originalGain: originalGainNow(),
    });
  }

  function startSourcesAtPlayhead(): void {
    if (!deck().hasStems()) return;
    deck().stop();

    const start = resolveStemStart({
      playerTimeSeconds: playerCurrentTime(document),
      elementTimeSeconds: element.currentTime,
      stemDurationSeconds: deck().durationSeconds(),
      deckTrackId: deck().trackId(),
      playerTrackId: deps.playerTrackId(),
    });
    lastStart = start;

    if (start.kind === "bypass") {
      handBackToOriginal(start.reason);
      return;
    }

    setOriginalGain(0);
    deck().startAt(start.offsetSeconds);
    deck().setMixLevel(currentMixLevel);
  }

  function stopDeck(): void {
    if (isCrossfading() && deps.ownAdvanceLanding()) return;
    checkPauseIsTheListeners(0);
  }

  function checkPauseIsTheListeners(attempt: number): void {
    if (attempt > PAUSE_CHECK_ATTEMPTS) return;
    setTimeout(() => {
      if (!element.paused) return;
      if (deps.ownAdvanceRecent()) {
        checkPauseIsTheListeners(attempt + 1);
        return;
      }
      if (abortCrossfade("the listener paused mid fade")) return;
      deck().stop();
      handBackToOriginal("the listener paused with no deck running");
    }, PAUSE_SETTLE_MS);
  }

  function onSeeked(): void {
    if (abortCrossfade("the listener seeked mid fade")) return;
    syncToElement();
  }

  function syncToElement(): void {
    if (!deck().hasStems() || bypass.isBypassed()) return;
    if (isCrossfading()) return;
    if (deck().isPlaying() && context.currentTime < driftSuppressedUntilContextTime) return;
    if (deck().isPlaying() && deps.ownAdvanceRecent()) return;
    if (element.paused) {
      if (deps.ownAdvanceRecent()) return;
      deck().stop();
      return;
    }
    const restart = shouldRestartStems({
      hasActiveSources: deck().isPlaying(),
      stemPositionSeconds: deck().positionNow(),
      playerPositionSeconds: playerCurrentTime(document),
    });
    if (restart) startSourcesAtPlayhead();
  }

  function attachTransportListeners(): void {
    if (transportAttached) return;
    transportAttached = true;
    element.addEventListener("play", syncToElement);
    element.addEventListener("playing", syncToElement);
    element.addEventListener("pause", stopDeck);
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("ratechange", syncToElement);
  }

  function loadStems(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number,
    trackId: string | null
  ): void {
    if (!deck().load({ kind: "stems", vocals, instrumental, sampleRate, trackId })) {
      logger.warn("load-stems carried no channels, staying on the original");
      return;
    }
    resumeStems();
  }

  function loadMix(mix: AudioBuffer, trackId: string | null): void {
    if (!deck().load({ kind: "mix", mix, trackId })) {
      logger.warn("the mix carried no channels, staying on the original");
      return;
    }
    resumeStems();
  }

  function resumeStems(): void {
    if (!deck().hasStems()) return;
    setOriginalGain(0);
    bypass.exitBypass();
    attachTransportListeners();
    if (!element.paused) startSourcesAtPlayhead();
  }

  function setMixLevel(mixLevel: number): void {
    currentMixLevel = mixLevel;
    deck().setMixLevel(mixLevel);
  }

  function recoverIfStopped(): boolean {
    if (bypass.isBypassed() || isCrossfading()) return false;

    if (element.paused && !deps.ownAdvanceRecent()) {
      if (deck().isPlaying()) deck().stop();
      return handBackToOriginal("the listener is paused, so nothing should be held silent");
    }

    if (deck().isPlaying() || element.paused) return false;
    if (!deck().hasStems()) return handBackToOriginal("no deck holds anything to play");
    if (deck().hasFinished()) return handBackToOriginal("the stems ran out before the track did");

    logger.warn("the deck stopped while the track kept playing, restarting it at the playhead");
    startSourcesAtPlayhead();
    return true;
  }

  function stopStems(): void {
    if (abortCrossfade("the stems were released mid fade")) return;
    bypass.enterBypass();
  }

  // -- Crossfade --------------------------------------------------------------

  function crossfadeTo(request: CrossfadeRequest): CrossfadeResult {
    const outgoingFrom = outgoingSource();
    const gate = decideCrossfade({
      crossfading: isCrossfading(),
      outgoing: outgoingFrom,
      durationSeconds: request.durationSeconds,
    });
    if (gate.kind === "refuse" || outgoingFrom === "none") {
      return { kind: "refused", reason: gate.kind === "refuse" ? gate.reason : "nothing is playing to fade out of" };
    }

    const incoming = idleDeck();
    if (!incoming.load(deckLoadFor(request))) {
      return { kind: "refused", reason: "the incoming stems carried no channels" };
    }

    const incomingState = incoming.describe();
    const judged = judgeIncomingStems({
      durationSeconds: incomingState.durationSeconds,
      vocalsRms: incomingState.kind === "mix" ? null : incomingState.vocalsRms,
      instrumentalRms: incomingState.instrumentalRms,
      fadeSeconds: request.durationSeconds,
    });
    if (judged.kind === "refuse") return { kind: "refused", reason: judged.reason };

    const outgoing = deck();
    const startsAt = context.currentTime + Math.max(0, request.startInSeconds ?? 0);
    const endsAt = startsAt + request.durationSeconds;

    incoming.setMixLevel(currentMixLevel);
    incoming.setGain(0);
    incoming.startAt(request.incomingOffsetSeconds ?? 0, startsAt);

    if (outgoingFrom === "deck") {
      outgoing
        .gainParam()
        .setValueCurveAtTime(equalPowerCurve(CROSSFADE_CURVE_STEPS, "out"), startsAt, request.durationSeconds);
      outgoing.stopAt(endsAt);
    } else {
      rampOriginalOut(startsAt, request.durationSeconds);
      silenceOriginalIfTheElementMovesOn(request.durationSeconds);
    }
    incoming
      .gainParam()
      .setValueCurveAtTime(equalPowerCurve(CROSSFADE_CURVE_STEPS, "in"), startsAt, request.durationSeconds);

    crossfade = {
      outgoingDeck: activeDeck,
      outgoingFrom,
      endsAtContextTime: endsAt,
      videoId: request.videoId ?? null,
    };
    activeDeck = activeDeck === 0 ? 1 : 0;
    bypass.exitBypass();
    attachTransportListeners();
    logger.log(
      `crossfading over ${request.durationSeconds.toFixed(2)} s out of the ${outgoingFrom} into a ${incomingState.kind}, deck ${activeDeck} takes over`
    );
    return { kind: "scheduled", startsAt, endsAt, outgoing: outgoingFrom };
  }

  function abortCrossfade(reason: string): boolean {
    if (!isCrossfading() || crossfade === null) return false;
    logger.warn(`crossfade aborted, ${reason}`);

    const abandoned = crossfade.videoId;
    const advanceLanded = abandoned !== null && deps.playerTrackId() === abandoned;
    if (!advanceLanded) activeDeck = crossfade.outgoingDeck;
    crossfade = null;
    for (const each of decks) {
      each.gainParam().cancelScheduledValues(context.currentTime);
      each.setGain(1);
      each.stop();
    }
    setOriginalGain(1);
    bypass.enterBypass();
    deps.onCrossfadeAborted?.(abandoned, reason);
    return true;
  }

  // -- Diagnostic tap ---------------------------------------------------------

  const RECORD_BUFFER_FRAMES = 16384;

  function recordOutput(seconds: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    const wanted = Math.max(1, Math.floor(context.sampleRate * seconds));
    const collected = new Float32Array(wanted);
    let written = 0;

    const processor = context.createScriptProcessor(RECORD_BUFFER_FRAMES, 1, 1);
    const silencer = context.createGain();
    silencer.gain.value = 0;
    masterNode.connect(processor);
    processor.connect(silencer);
    silencer.connect(context.destination);

    return new Promise(resolve => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        processor.onaudioprocess = null;
        masterNode.disconnect(processor);
        processor.disconnect();
        silencer.disconnect();
        resolve({ samples: collected.subarray(0, written), sampleRate: context.sampleRate });
      };

      processor.onaudioprocess = event => {
        const input = event.inputBuffer.getChannelData(0);
        const room = Math.min(input.length, wanted - written);
        if (room > 0) {
          collected.set(input.subarray(0, room), written);
          written += room;
        }
        if (written >= wanted) finish();
      };

      setTimeout(finish, (seconds + 2) * 1000);
    });
  }

  function dispose(): void {
    crossfade = null;
    for (const each of decks) each.dispose();
    element.removeEventListener("volumechange", syncListenerVolume);

    setOriginalGain(1);
    source.disconnect(originalGainNode);
    originalGainNode.disconnect();
    listenerVolumeNode.disconnect();
    masterNode.disconnect();
    source.connect(context.destination);

    if (!transportAttached) return;
    transportAttached = false;
    element.removeEventListener("play", syncToElement);
    element.removeEventListener("playing", syncToElement);
    element.removeEventListener("pause", stopDeck);
    element.removeEventListener("seeked", onSeeked);
    element.removeEventListener("ratechange", syncToElement);
  }

  function describe(): GraphState {
    const deckState = deck().describe();
    return {
      engaged: !bypass.isBypassed(),
      vocalsGain: deckState.vocalsGain,
      instrumentalGain: deckState.instrumentalGain,
      originalGain: originalGainNow(),
      contextSampleRate: context.sampleRate,
      stemsLoaded: deckState.stemsLoaded,
      stemFrames: deckState.stemFrames,
      stemSampleRate: deckState.stemSampleRate,
      vocalsRms: deckState.vocalsRms,
      instrumentalRms: deckState.instrumentalRms,
      combinedPeak: deckState.combinedPeak,
      stemsPlaying: deckState.playing,
      elementTime: Number.isFinite(element.currentTime) ? element.currentTime : 0,
      playerTime: playerCurrentTime(document),
      startOffset: lastStart?.kind === "start" ? lastStart.offsetSeconds : null,
      startSource: lastStart?.kind === "start" ? lastStart.source : null,
      startRefusedBecause: lastStart?.kind === "bypass" ? lastStart.reason : null,
      listenerGain: listenerVolumeNode.gain.value,
      activeDeck,
      crossfading: isCrossfading(),
      outgoingSource: outgoingSource(),
      decks: [decks[0].describe(), decks[1].describe()],
    };
  }

  return {
    loadStems,
    loadMix,
    setMixLevel,
    stopStems,
    resumeStems,
    crossfadeTo,
    abortCrossfade,
    recoverIfStopped,
    suppressDriftFor: seconds => {
      driftSuppressedUntilContextTime = context.currentTime + Math.max(0, seconds);
    },
    recordOutput,
    isEngaged: () => !bypass.isBypassed(),
    dispose,
    describe,
  };
}

export { createPlaybackGraph };
export type { CrossfadeRequest, CrossfadeResult, GraphState, PlaybackGraph, PlaybackGraphDeps };
