// -- Playback graph ----------------------------------------------------------

import { decideCrossfade, judgeIncomingStems } from "@/automix/crossfade-gate";
import { CROSSFADE_CURVE_STEPS, equalPowerCurve, fadeCurve } from "@/automix/transition";
import { audibleSource } from "@/pageworld/audible-source";
import type { AudibleSource } from "@/pageworld/audible-source";
import { createBypassController } from "@/pageworld/bypass";
import { createDeck } from "@/pageworld/deck";
import type { Deck, DeckLoad, DeckState } from "@/pageworld/deck";
import { MIX_GLIDE_SECONDS, NEUTRAL_MIX_LEVEL, faderArmed, listenerGain } from "@/pageworld/gain-law";
import { GAIN_RAMP_SECONDS, rampGainTo, scheduleGainCurve } from "@/pageworld/gain-ramp";
import { playerCurrentTime } from "@/pageworld/player-state";
import { describeStandDown, standDownReason } from "@/pageworld/stand-down";
import { resolveStemStart } from "@/pageworld/stem-offset";
import { FRAME_SECONDS, chooseSwapDelaySeconds } from "@/pageworld/swap-window";
import type { StemStart } from "@/pageworld/stem-offset";
import { DRIFT_SEEK_SETTLE_S, decideDriftCorrection } from "@/pageworld/stem-restart";
import { createLogger } from "@/shared/logger";

const logger = createLogger("page");

const PAUSE_SETTLE_MS = 600;
const SWAP_SECONDS = 0.12;
const HANDOVER_SECONDS = 0.02;
const SWAP_SEARCH_SECONDS = 3;
const ELEMENT_STALL_SECONDS = 2;
const PAUSE_CHECK_ATTEMPTS = 20;

interface PlaybackGraphDeps {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  playerTrackId(): string | null;
  ownAdvanceLanding(): boolean;
  ownAdvanceRecent(): boolean;
  consumeOwnSeek(): boolean;
  seekPlayerTo(seconds: number): boolean;
  onListenerSeeked?(): void;
  onCrossfadeAborted?(videoId: string | null, reason: string): void;
}

interface CrossfadeTiming {
  durationSeconds: number;
  incomingOffsetSeconds?: number;
  startInSeconds?: number;
  videoId?: string;
  kind?: HandoverKind;
}

type HandoverKind = "transition" | "swap";

interface StemsCrossfadeRequest extends CrossfadeTiming {
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
  mix?: undefined;
}

interface MixCrossfadeRequest extends CrossfadeTiming {
  mix: AudioBuffer;
  vocals?: undefined;
  instrumental?: undefined;
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
  elementStalled: boolean;
  startOffset: number | null;
  startSource: string | null;
  startRefusedBecause: string | null;
  listenerGain: number;
  activeDeck: 0 | 1;
  crossfading: boolean;
  outgoingSource: AudibleSource;
  decks: [DeckState, DeckState];
}

interface PlaybackGraph {
  loadStems(vocals: AudioBuffer, instrumental: AudioBuffer, trackId: string | null): void;
  loadMix(mix: AudioBuffer, trackId: string | null): void;
  setMixLevel(mixLevel: number, seconds?: number): void;
  stopStems(reason?: string): void;
  resumeStems(): void;
  crossfadeTo(request: CrossfadeRequest): CrossfadeResult;
  abortCrossfade(reason: string): boolean;
  suppressDriftFor(seconds: number): void;
  recoverIfStopped(): boolean;
  recordOutput(seconds: number): Promise<{ samples: Float32Array; sampleRate: number }>;
  heldBuffers(): AudioBuffer[];
  isEngaged(): boolean;
  dispose(): void;
  describe(): GraphState;
}

function deckLoadFor(request: CrossfadeRequest): DeckLoad {
  const trackId = request.videoId ?? null;
  if (request.mix !== undefined) return { kind: "mix", mix: request.mix, trackId };
  return { kind: "stems", vocals: request.vocals, instrumental: request.instrumental, trackId };
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
    kind: HandoverKind;
  } | null = null;
  decks[1].setGain(0, 0);

  const deck = (): Deck => decks[activeDeck];
  const idleDeck = (): Deck => decks[activeDeck === 0 ? 1 : 0];
  const isCrossfading = (): boolean => crossfade !== null && context.currentTime < crossfade.endsAtContextTime;

  const originalGainNode = context.createGain();
  source.disconnect(context.destination);
  source.connect(originalGainNode);
  originalGainNode.connect(masterNode);

  let originalTarget = 1;

  function setOriginalGain(value: number, seconds = GAIN_RAMP_SECONDS): void {
    originalTarget = value;
    rampGainTo(originalGainNode.gain, context, value, seconds);
  }

  function rampOriginalOut(startsAt: number, durationSeconds: number): void {
    originalTarget = 0;
    scheduleGainCurve(
      originalGainNode.gain,
      context,
      equalPowerCurve(CROSSFADE_CURVE_STEPS, "out"),
      startsAt,
      durationSeconds
    );
  }

  const originalGainNow = (): number => originalGainNode.gain.value;
  setOriginalGain(1);

  let currentMixLevel = 1;
  let transportAttached = false;
  let lastStart: StemStart | null = null;
  let driftSuppressedUntilContextTime = 0;
  let deferredHandover: ReturnType<typeof setTimeout> | null = null;
  let lastElementTime = Number.NaN;
  let elementMovedAtContextTime = 0;

  const element = source.mediaElement;

  function noteElementProgress(): void {
    if (element.currentTime === lastElementTime) return;
    lastElementTime = element.currentTime;
    elementMovedAtContextTime = context.currentTime;
  }

  function elementStalled(): boolean {
    if (element.paused) return false;
    if (!Number.isFinite(lastElementTime)) return false;
    return context.currentTime - elementMovedAtContextTime > ELEMENT_STALL_SECONDS;
  }

  function suppressDrift(seconds: number): void {
    const until = context.currentTime + Math.max(0, seconds);
    driftSuppressedUntilContextTime = Math.max(driftSuppressedUntilContextTime, until);
  }

  function syncListenerVolume(): void {
    rampGainTo(listenerVolumeNode.gain, context, listenerGain(element.volume, element.muted));
  }
  syncListenerVolume();
  element.addEventListener("volumechange", syncListenerVolume);

  const bypass = createBypassController({
    restoreOriginal() {
      setOriginalGain(1);
    },
    stopStems() {
      deck().fadeOutAndStop();
    },
  });

  function handBackToOriginal(reason: string): boolean {
    if (originalTarget === 1) return false;
    logger.log(`handing back to the original, ${reason}`);
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

  function whatIsAudible(): AudibleSource {
    return audibleSource({
      bypassed: bypass.isBypassed(),
      deckPlaying: deck().isPlaying(),
      elementPaused: element.paused,
      originalGain: originalGainNow(),
    });
  }

  function startSourcesAtPlayhead(): void {
    if (!deck().hasStems()) return;
    cancelDeferredHandover();
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

    setOriginalGain(0, HANDOVER_SECONDS);
    deck().startAt(start.offsetSeconds);
    deck().fadeIn(HANDOVER_SECONDS);
    if (!faderArmed(currentMixLevel)) {
      deck().setMixLevel(currentMixLevel);
      return;
    }
    deck().setMixLevel(NEUTRAL_MIX_LEVEL, 0);
    deck().setMixLevel(currentMixLevel, MIX_GLIDE_SECONDS);
    logger.log(`easing the vocals to ${currentMixLevel.toFixed(2)} over ${MIX_GLIDE_SECONDS} s`);
  }

  function stopDeck(): void {
    if (isCrossfading() && deps.ownAdvanceLanding()) return;
    checkPauseIsTheListeners(0);
  }

  function checkPauseIsTheListeners(attempt: number): void {
    if (attempt > PAUSE_CHECK_ATTEMPTS) return;
    setTimeout(() => {
      if (!element.paused) return;
      if (isCrossfading() || deps.ownAdvanceLanding()) {
        checkPauseIsTheListeners(attempt + 1);
        return;
      }
      if (abortCrossfade("the listener paused mid fade")) return;
      deck().fadeOutAndStop();
      handBackToOriginal("the listener paused with no deck running");
    }, PAUSE_SETTLE_MS);
  }

  function onSeeked(): void {
    if (deps.consumeOwnSeek()) {
      syncToElement(false);
      return;
    }
    deps.onListenerSeeked?.();
    if (abortCrossfade("the listener seeked mid fade")) return;
    syncToElement(true);
  }

  function onTransport(): void {
    syncToElement(false);
  }

  function onRateChange(): void {
    const reason = standDownReason({ adPlaying: false, playbackRate: element.playbackRate });
    if (reason === null) {
      syncToElement(false);
      return;
    }
    stopStems(describeStandDown(reason));
  }

  function syncToElement(listenerSeeked: boolean): void {
    if (!deck().hasStems() || bypass.isBypassed()) return;
    if (isCrossfading()) return;
    if (deck().isPlaying() && !listenerSeeked && context.currentTime < driftSuppressedUntilContextTime) return;
    if (deck().isPlaying() && !listenerSeeked && deps.ownAdvanceRecent()) return;
    if (element.paused) {
      if (deps.ownAdvanceRecent()) return;
      deck().fadeOutAndStop();
      return;
    }

    const correction = decideDriftCorrection({
      hasActiveSources: deck().isPlaying(),
      stemPositionSeconds: deck().positionNow(),
      playerPositionSeconds: playerCurrentTime(document),
      listenerSeeked,
      originalGain: originalGainNow(),
      elementStalled: elementStalled(),
    });
    if (correction.kind === "hold") return;
    if (correction.kind === "restart-deck") {
      startSourcesAtPlayhead();
      return;
    }

    suppressDrift(DRIFT_SEEK_SETTLE_S);
    if (!deps.seekPlayerTo(correction.toSeconds)) {
      logger.warn("the player would not seek, its clock stays adrift from the deck");
      return;
    }
    logger.log(`the player is ${correction.driftSeconds.toFixed(3)} s off the deck, seeking the silent player onto it`);
  }

  function attachTransportListeners(): void {
    if (transportAttached) return;
    transportAttached = true;
    element.addEventListener("play", onTransport);
    element.addEventListener("playing", onTransport);
    element.addEventListener("pause", stopDeck);
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("ratechange", onRateChange);
  }

  function loadStems(vocals: AudioBuffer, instrumental: AudioBuffer, trackId: string | null): void {
    adoptTrack({ kind: "stems", vocals, instrumental, trackId }, "load-stems");
  }

  function loadMix(mix: AudioBuffer, trackId: string | null): void {
    adoptTrack({ kind: "mix", mix, trackId }, "the mix");
  }

  function adoptTrack(load: DeckLoad, what: string): void {
    if (swapInPlace(load)) return;
    if (!deck().load(load)) {
      logger.warn(`${what} carried no channels, staying on the original`);
      return;
    }
    resumeStems();
  }

  function swapInPlace(load: DeckLoad): boolean {
    if (load.trackId === null || deck().trackId() !== load.trackId) return false;
    if (whatIsAudible() !== "deck") return false;

    const position = deck().positionNow();
    if (!Number.isFinite(position)) return false;

    const request: CrossfadeRequest =
      load.kind === "mix"
        ? { mix: load.mix, durationSeconds: SWAP_SECONDS }
        : { vocals: load.vocals, instrumental: load.instrumental, durationSeconds: SWAP_SECONDS };

    const result = crossfadeTo({
      ...request,
      videoId: load.trackId,
      incomingOffsetSeconds: position,
      startInSeconds: 0,
      kind: "swap",
    });
    if (result.kind === "refused") {
      logger.log(`not swapping ${load.trackId} in place, ${result.reason}`);
      return false;
    }
    logger.log(`swapped ${load.trackId} to a ${load.kind} deck at ${position.toFixed(2)} s, without a cut`);
    return true;
  }

  function resumeStems(): void {
    if (!deck().hasStems()) return;
    bypass.exitBypass();
    attachTransportListeners();
    if (element.paused) {
      setOriginalGain(0, HANDOVER_SECONDS);
      return;
    }

    const delay = chooseSwapDelaySeconds({
      envelope: deck().envelope(),
      frameSeconds: FRAME_SECONDS,
      fromSeconds: playerCurrentTime(document),
      withinSeconds: SWAP_SEARCH_SECONDS,
      fadeSeconds: HANDOVER_SECONDS,
    });
    if (delay <= 0) {
      startSourcesAtPlayhead();
      return;
    }

    const waitingFor = deck().trackId();
    logger.log(`holding the handover ${delay.toFixed(2)} s for a quieter passage`);
    deferredHandover = setTimeout(() => {
      deferredHandover = null;
      if (bypass.isBypassed() || isCrossfading() || element.paused) return;
      if (deck().trackId() !== waitingFor) return;
      if (deps.playerTrackId() !== null && deps.playerTrackId() !== waitingFor) return;
      startSourcesAtPlayhead();
    }, delay * 1000);
  }

  function cancelDeferredHandover(): void {
    if (deferredHandover === null) return;
    clearTimeout(deferredHandover);
    deferredHandover = null;
  }

  function setMixLevel(mixLevel: number, seconds?: number): void {
    currentMixLevel = mixLevel;
    deck().setMixLevel(mixLevel, seconds);
  }

  function recoverIfStopped(): boolean {
    noteElementProgress();
    if (bypass.isBypassed() || isCrossfading()) return false;

    if (element.paused && !deps.ownAdvanceRecent()) {
      if (deck().isPlaying()) deck().fadeOutAndStop();
      return handBackToOriginal("the listener is paused, so nothing should be held silent");
    }

    if (deck().isPlaying() || element.paused) return false;
    if (!deck().hasStems()) return handBackToOriginal("no deck holds anything to play");
    if (deck().hasFinished()) return handBackToOriginal("the stems ran out before the track did");

    logger.log("the deck stopped while the track kept playing, restarting it at the playhead");
    startSourcesAtPlayhead();
    return true;
  }

  function stopStems(reason = "the deck was released"): void {
    cancelDeferredHandover();
    if (abortCrossfade(`the stems were released mid fade, ${reason}`)) return;
    if (!bypass.isBypassed()) logger.log(`bypassing to the original, ${reason}`);
    bypass.enterBypass();
  }

  // -- Crossfade --------------------------------------------------------------

  function crossfadeTo(request: CrossfadeRequest): CrossfadeResult {
    const outgoingFrom = whatIsAudible();
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
      offsetSeconds: request.incomingOffsetSeconds ?? 0,
    });
    if (judged.kind === "refuse") return { kind: "refused", reason: judged.reason };

    const outgoing = deck();
    const startsAt = context.currentTime + Math.max(0, request.startInSeconds ?? 0);
    const endsAt = startsAt + request.durationSeconds;

    incoming.setMixLevel(currentMixLevel);
    incoming.setGain(0, 0);
    incoming.startAt(request.incomingOffsetSeconds ?? 0, startsAt);

    const kind = request.kind ?? "transition";
    const shape = kind === "swap" ? "equal-gain" : "equal-power";
    if (outgoingFrom === "deck") {
      scheduleGainCurve(
        outgoing.gainParam(),
        context,
        fadeCurve(CROSSFADE_CURVE_STEPS, "out", shape),
        startsAt,
        request.durationSeconds
      );
      outgoing.stopAt(endsAt);
    } else {
      rampOriginalOut(startsAt, request.durationSeconds);
      silenceOriginalIfTheElementMovesOn(request.durationSeconds);
    }
    scheduleGainCurve(
      incoming.gainParam(),
      context,
      fadeCurve(CROSSFADE_CURVE_STEPS, "in", shape),
      startsAt,
      request.durationSeconds
    );

    crossfade = {
      outgoingDeck: activeDeck,
      outgoingFrom,
      endsAtContextTime: endsAt,
      videoId: request.videoId ?? null,
      kind,
    };
    activeDeck = activeDeck === 0 ? 1 : 0;
    bypass.exitBypass();
    attachTransportListeners();
    logger.log(
      `${kind === "swap" ? "swapping" : "crossfading"} over ${request.durationSeconds.toFixed(2)} s out of the ${outgoingFrom} into a ${incomingState.kind}, deck ${activeDeck} takes over`
    );
    return { kind: "scheduled", startsAt, endsAt, outgoing: outgoingFrom };
  }

  function abortCrossfade(reason: string): boolean {
    if (!isCrossfading() || crossfade === null) return false;
    logger.log(`crossfade aborted, ${reason}`);

    const abandoned = crossfade.videoId;
    const wasTransition = crossfade.kind === "transition";
    const advanceLanded = abandoned !== null && deps.playerTrackId() === abandoned;
    if (wasTransition && !advanceLanded) activeDeck = crossfade.outgoingDeck;
    crossfade = null;
    for (const each of decks) each.fadeOutAndStop();
    setOriginalGain(1);
    bypass.enterBypass();
    if (wasTransition) deps.onCrossfadeAborted?.(abandoned, reason);
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
    cancelDeferredHandover();
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
    element.removeEventListener("play", onTransport);
    element.removeEventListener("playing", onTransport);
    element.removeEventListener("pause", stopDeck);
    element.removeEventListener("seeked", onSeeked);
    element.removeEventListener("ratechange", onRateChange);
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
      elementStalled: elementStalled(),
      startOffset: lastStart?.kind === "start" ? lastStart.offsetSeconds : null,
      startSource: lastStart?.kind === "start" ? lastStart.source : null,
      startRefusedBecause: lastStart?.kind === "bypass" ? lastStart.reason : null,
      listenerGain: listenerVolumeNode.gain.value,
      activeDeck,
      crossfading: isCrossfading(),
      outgoingSource: whatIsAudible(),
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
    suppressDriftFor: suppressDrift,
    recordOutput,
    heldBuffers: () => [...decks[0].heldBuffers(), ...decks[1].heldBuffers()],
    isEngaged: () => !bypass.isBypassed(),
    dispose,
    describe,
  };
}

export { createPlaybackGraph };
export type { CrossfadeRequest, CrossfadeResult, GraphState, HandoverKind, PlaybackGraph, PlaybackGraphDeps };
