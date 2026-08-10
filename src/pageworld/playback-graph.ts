// -- Playback graph ----------------------------------------------------------

import { decideCrossfade } from "@/automix/crossfade-gate";
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
}

interface CrossfadeRequest {
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  durationSeconds: number;
  incomingOffsetSeconds?: number;
  startAtContextTime?: number;
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
  instrumentalRms: number;
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
  let crossfade: { outgoingDeck: 0 | 1; endsAtContextTime: number } | null = null;
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
    // belongs to the outgoing track, so drift correction would fight it.
    if (isCrossfading()) return;
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

    const outgoing = deck();
    const startsAt = Math.max(request.startAtContextTime ?? context.currentTime, context.currentTime);
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

    crossfade = { outgoingDeck: activeDeck, endsAtContextTime: endsAt };
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

    activeDeck = crossfade.outgoingDeck;
    crossfade = null;
    for (const each of decks) {
      each.gainParam().cancelScheduledValues(context.currentTime);
      each.setGain(1);
      each.stop();
    }
    bypass.enterBypass();
    return true;
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
      instrumentalRms: deckState.instrumentalRms,
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
    isEngaged: () => !bypass.isBypassed(),
    dispose,
    describe,
  };
}

export { createPlaybackGraph };
export type { CrossfadeRequest, CrossfadeResult, GraphState, PlaybackGraph, PlaybackGraphDeps };
