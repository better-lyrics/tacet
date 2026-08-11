// -- Playback graph ----------------------------------------------------------

import { decideCrossfade, judgeIncomingStems } from "@/automix/crossfade-gate";
import { CROSSFADE_CURVE_STEPS, equalPowerCurve } from "@/automix/transition";
import { createBypassController } from "@/pageworld/bypass";
import { createDeck } from "@/pageworld/deck";
import { listenerGain } from "@/pageworld/gain-law";
import { playerCurrentTime } from "@/pageworld/player-state";
import { resolveStemStart } from "@/pageworld/stem-offset";
import { shouldRestartStems } from "@/pageworld/stem-restart";
import type { Deck, DeckState } from "@/pageworld/deck";
import type { StemStart } from "@/pageworld/stem-offset";
import { createLogger } from "@/shared/logger";

const logger = createLogger("page");

interface PlaybackGraphDeps {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  // A fade can be unwound from a transport listener the caller never sees, and
  // the bookkeeping it moved across has to move back.
  onCrossfadeAborted?(videoId: string | null, reason: string): void;
}

interface CrossfadeRequest {
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  durationSeconds: number;
  incomingOffsetSeconds?: number;
  startInSeconds?: number;
  videoId?: string;
}

type CrossfadeResult = { kind: "scheduled"; startsAt: number; endsAt: number } | { kind: "refused"; reason: string };

interface GraphState {
  engaged: boolean;
  vocalsGain: number;
  instrumentalGain: number;
  originalGain: number;
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
  decks: [DeckState, DeckState];
}

interface PlaybackGraph {
  loadStems(vocals: Float32Array<ArrayBuffer>[], instrumental: Float32Array<ArrayBuffer>[], sampleRate: number): void;
  setMixLevel(mixLevel: number): void;
  stopStems(): void;
  resumeStems(): void;
  crossfadeTo(request: CrossfadeRequest): CrossfadeResult;
  abortCrossfade(reason: string): boolean;
  suppressDriftFor(seconds: number): void;
  recordOutput(seconds: number): Promise<{ samples: Float32Array; sampleRate: number }>;
  isEngaged(): boolean;
  dispose(): void;
  // What actually reached Web Audio, not what the pipeline believes it sent.
  describe(): GraphState;
}

function createPlaybackGraph(deps: PlaybackGraphDeps): PlaybackGraph {
  const { context, source } = deps;

  // -- Stem path: the deck, then the listener's own volume, then out ----------

  const listenerVolumeNode = context.createGain();
  listenerVolumeNode.connect(context.destination);

  const decks: [Deck, Deck] = [
    createDeck({ context, output: listenerVolumeNode }),
    createDeck({ context, output: listenerVolumeNode }),
  ];
  let activeDeck: 0 | 1 = 0;
  let crossfade: { outgoingDeck: 0 | 1; endsAtContextTime: number; videoId: string | null } | null = null;
  decks[1].setGain(0);

  const deck = (): Deck => decks[activeDeck];
  const idleDeck = (): Deck => decks[activeDeck === 0 ? 1 : 0];
  const isCrossfading = (): boolean => crossfade !== null && context.currentTime < crossfade.endsAtContextTime;

  const originalGainNode = context.createGain();
  originalGainNode.gain.value = 1;
  source.disconnect(context.destination);
  source.connect(originalGainNode);
  originalGainNode.connect(context.destination);

  let currentMixLevel = 1;
  let transportAttached = false;
  let lastStart: StemStart | null = null;
  let driftSuppressedUntilContextTime = 0;

  // Followed directly, rather than being told about the transport.
  const element = source.mediaElement;

  function syncListenerVolume(): void {
    listenerVolumeNode.gain.value = listenerGain(element.volume, element.muted);
  }
  syncListenerVolume();
  element.addEventListener("volumechange", syncListenerVolume);

  const bypass = createBypassController({
    restoreOriginal() {
      originalGainNode.gain.value = 1;
    },
    stopStems() {
      deck().stop();
    },
  });

  function startSourcesAtPlayhead(): void {
    if (!deck().hasStems()) return;
    deck().stop();

    const start = resolveStemStart({
      playerTimeSeconds: playerCurrentTime(document),
      elementTimeSeconds: element.currentTime,
      stemDurationSeconds: deck().durationSeconds(),
    });
    lastStart = start;

    if (start.kind === "bypass") {
      logger.warn(`handing back to the original, ${start.reason}`);
      originalGainNode.gain.value = 1;
      return;
    }

    originalGainNode.gain.value = 0;
    deck().startAt(start.offsetSeconds);
    deck().setMixLevel(currentMixLevel);
  }

  function stopDeck(): void {
    if (abortCrossfade("the listener paused mid fade")) return;
    deck().stop();
  }

  function syncToElement(): void {
    if (!deck().hasStems() || bypass.isBypassed()) return;
    // A crossfade owns both decks' timelines, and the player clock still
    // belongs to the outgoing track, so drift correction would fight it. The
    // same holds for the moment after it, while the player is being seeked to
    // meet the deck: correcting then would restart the deck against a clock
    // that is deliberately in motion.
    if (isCrossfading() || context.currentTime < driftSuppressedUntilContextTime) return;
    if (element.paused) {
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
    element.addEventListener("seeked", syncToElement);
    element.addEventListener("ratechange", syncToElement);
  }

  function loadStems(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number
  ): void {
    if (!deck().load(vocals, instrumental, sampleRate)) {
      logger.warn("load-stems carried no channels, staying on the original");
      return;
    }
    resumeStems();
  }

  function resumeStems(): void {
    if (!deck().hasStems()) return;
    originalGainNode.gain.value = 0;
    bypass.exitBypass();
    attachTransportListeners();
    // Start where the listener actually is, not at the beginning of the track.
    if (!element.paused) startSourcesAtPlayhead();
  }

  function setMixLevel(mixLevel: number): void {
    currentMixLevel = mixLevel;
    deck().setMixLevel(mixLevel);
  }

  function stopStems(): void {
    if (abortCrossfade("the stems were released mid fade")) return;
    bypass.enterBypass();
  }

  // -- Crossfade --------------------------------------------------------------

  function crossfadeTo(request: CrossfadeRequest): CrossfadeResult {
    const gate = decideCrossfade({
      crossfading: isCrossfading(),
      bypassed: bypass.isBypassed(),
      outgoingPlaying: deck().isPlaying(),
      durationSeconds: request.durationSeconds,
    });
    if (gate.kind === "refuse") return { kind: "refused", reason: gate.reason };

    const incoming = idleDeck();
    if (!incoming.load(request.vocals, request.instrumental, request.sampleRate)) {
      return { kind: "refused", reason: "the incoming stems carried no channels" };
    }

    const incomingState = incoming.describe();
    const stems = judgeIncomingStems({
      durationSeconds: incomingState.durationSeconds,
      vocalsRms: incomingState.vocalsRms,
      instrumentalRms: incomingState.instrumentalRms,
      fadeSeconds: request.durationSeconds,
    });
    if (stems.kind === "refuse") return { kind: "refused", reason: stems.reason };

    const outgoing = deck();
    const startsAt = context.currentTime + Math.max(0, request.startInSeconds ?? 0);
    const endsAt = startsAt + request.durationSeconds;

    incoming.setMixLevel(currentMixLevel);
    incoming.setGain(0);
    incoming.startAt(request.incomingOffsetSeconds ?? 0, startsAt);

    outgoing
      .gainParam()
      .setValueCurveAtTime(equalPowerCurve(CROSSFADE_CURVE_STEPS, "out"), startsAt, request.durationSeconds);
    incoming
      .gainParam()
      .setValueCurveAtTime(equalPowerCurve(CROSSFADE_CURVE_STEPS, "in"), startsAt, request.durationSeconds);
    outgoing.stopAt(endsAt);

    crossfade = { outgoingDeck: activeDeck, endsAtContextTime: endsAt, videoId: request.videoId ?? null };
    activeDeck = activeDeck === 0 ? 1 : 0;
    logger.log(`crossfading over ${request.durationSeconds.toFixed(2)} s, deck ${activeDeck} takes over`);
    return { kind: "scheduled", startsAt, endsAt };
  }

  // A fade that never completes leaves both decks holding a ramp and the
  // wrong one active, so unwinding it is one operation rather than a recovery
  // per caller.
  function abortCrossfade(reason: string): boolean {
    if (!isCrossfading() || crossfade === null) return false;
    logger.warn(`crossfade aborted, ${reason}`);

    const abandoned = crossfade.videoId;
    activeDeck = crossfade.outgoingDeck;
    crossfade = null;
    for (const each of decks) {
      each.gainParam().cancelScheduledValues(context.currentTime);
      each.setGain(1);
      each.stop();
    }
    bypass.enterBypass();
    deps.onCrossfadeAborted?.(abandoned, reason);
    return true;
  }

  // -- Diagnostic tap ---------------------------------------------------------

  // A parallel branch into a silenced gain, so a late callback can only cost
  // recorded frames, never audible ones. The count is returned so a short
  // recording can be told from a stalled one.
  const RECORD_BUFFER_FRAMES = 16384;

  function recordOutput(seconds: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    const wanted = Math.max(1, Math.floor(context.sampleRate * seconds));
    const collected = new Float32Array(wanted);
    let written = 0;

    const processor = context.createScriptProcessor(RECORD_BUFFER_FRAMES, 1, 1);
    const silencer = context.createGain();
    silencer.gain.value = 0;
    listenerVolumeNode.connect(processor);
    processor.connect(silencer);
    silencer.connect(context.destination);

    return new Promise(resolve => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        processor.onaudioprocess = null;
        listenerVolumeNode.disconnect(processor);
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

    originalGainNode.gain.value = 1;
    source.disconnect(originalGainNode);
    originalGainNode.disconnect();
    listenerVolumeNode.disconnect();
    source.connect(context.destination);

    if (!transportAttached) return;
    transportAttached = false;
    element.removeEventListener("play", syncToElement);
    element.removeEventListener("playing", syncToElement);
    element.removeEventListener("pause", stopDeck);
    element.removeEventListener("seeked", syncToElement);
    element.removeEventListener("ratechange", syncToElement);
  }

  function describe(): GraphState {
    const deckState = deck().describe();
    return {
      engaged: !bypass.isBypassed(),
      vocalsGain: deckState.vocalsGain,
      instrumentalGain: deckState.instrumentalGain,
      originalGain: originalGainNode.gain.value,
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
      decks: [decks[0].describe(), decks[1].describe()],
    };
  }

  return {
    loadStems,
    setMixLevel,
    stopStems,
    resumeStems,
    crossfadeTo,
    abortCrossfade,
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
