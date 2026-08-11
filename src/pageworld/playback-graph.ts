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
  // Which track the listener is on, answered for the moment rather than read
  // off the player, which keeps naming the previous track for several seconds
  // after a transition. Null means genuinely unknown, which reads as "no
  // opinion" rather than "a different track".
  playerTrackId(): string | null;
  // True while a track change this graph asked for has not reached the player
  // yet. In that window a transport event is ours, not the listener's.
  ownAdvanceLanding(): boolean;
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
  loadStems(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number,
    trackId: string | null
  ): void;
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
  // What actually reached Web Audio, not what the pipeline believes it sent.
  describe(): GraphState;
}

function createPlaybackGraph(deps: PlaybackGraphDeps): PlaybackGraph {
  const { context, source } = deps;

  // -- Stem path: the deck, then the listener's own volume, then out ----------

  // Both paths meet here rather than at the destination, so a tap on it hears
  // what the listener hears. Reading the stem path alone cannot tell a stopped
  // deck from a graph that has handed back to the original, and those two
  // sound nothing alike.
  const masterNode = context.createGain();
  masterNode.connect(context.destination);

  const listenerVolumeNode = context.createGain();
  listenerVolumeNode.connect(masterNode);

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
  source.disconnect(context.destination);
  source.connect(originalGainNode);
  originalGainNode.connect(masterNode);

  // The one writer of the original's gain. Assigning `.value` is defined as
  // scheduling at the current time, so an assignment landing inside a ramp
  // someone else scheduled is undefined at best and throws at worst. Cancelling
  // first makes every write win outright, whoever scheduled what before it.
  function setOriginalGain(value: number): void {
    originalGainNode.gain.cancelScheduledValues(context.currentTime);
    originalGainNode.gain.value = value;
  }
  const originalGainNow = (): number => originalGainNode.gain.value;
  setOriginalGain(1);

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
      setOriginalGain(1);
    },
    stopStems() {
      deck().stop();
    },
  });

  // Unmuting the original is the fallback for every refusal, so it is one
  // operation rather than a gain assignment repeated per caller. It reports
  // whether it changed anything, which is what stops a polled caller logging
  // the same refusal every second.
  function handBackToOriginal(reason: string): boolean {
    if (originalGainNow() === 1) return false;
    logger.warn(`handing back to the original, ${reason}`);
    setOriginalGain(1);
    return true;
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

  // The transition's own midpoint advance makes YouTube emit a pause, so an
  // unqualified abort here tears down the fade that fired it. The suppression
  // is narrowed to a fade still in flight during our own advance: outside that
  // pair, a pause is the listener's and still stops the deck.
  function stopDeck(): void {
    if (isCrossfading() && deps.ownAdvanceLanding()) return;
    if (abortCrossfade("the listener paused mid fade")) return;
    deck().stop();
  }

  // Unlike play and playing, which the transition's own advance fires, a seek
  // during a fade is always the listener's: nothing here seeks until the fade
  // is over. Ignoring it leaves the fade running from a position they have
  // already left.
  function onSeeked(): void {
    if (abortCrossfade("the listener seeked mid fade")) return;
    syncToElement();
  }

  function syncToElement(): void {
    if (!deck().hasStems() || bypass.isBypassed()) return;
    // A crossfade owns both decks' timelines, and the player clock still
    // belongs to the outgoing track, so drift correction would fight it. The
    // same holds for the moment after it, while the player is being seeked to
    // meet the deck. Suppression covers drift only, never a deck that has
    // stopped: this listener is also the path that restarts one, and blocking
    // it outright turned the moment after a fade into silence that nothing
    // recovered from.
    if (isCrossfading()) return;
    if (deck().isPlaying() && context.currentTime < driftSuppressedUntilContextTime) return;
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
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("ratechange", syncToElement);
  }

  function loadStems(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number,
    trackId: string | null
  ): void {
    if (!deck().load(vocals, instrumental, sampleRate, trackId)) {
      logger.warn("load-stems carried no channels, staying on the original");
      return;
    }
    resumeStems();
  }

  function resumeStems(): void {
    if (!deck().hasStems()) return;
    setOriginalGain(0);
    bypass.exitBypass();
    attachTransportListeners();
    // Start where the listener actually is, not at the beginning of the track.
    if (!element.paused) startSourcesAtPlayhead();
  }

  function setMixLevel(mixLevel: number): void {
    currentMixLevel = mixLevel;
    deck().setMixLevel(mixLevel);
  }

  // After a transition the stems keep their identity across the track change,
  // so the engagement state machine reads "hold" and has no reason to touch
  // the deck. If a transport event stopped it in the meantime, nothing else
  // would ever start it again, and the listener just gets silence. This is the
  // one polled path that notices.
  //
  // A timer is weak evidence, unlike a transport event, so a deck that simply
  // ran out is not restarted: the stems end a fraction before the element
  // does, and restarting on that made every natural track end look like a
  // stall. It still has to be answered, though, because a deck holding less
  // than the whole track leaves the original silenced with nothing playing.
  function recoverIfStopped(): boolean {
    if (bypass.isBypassed() || isCrossfading()) return false;
    if (!deck().hasStems() || deck().isPlaying()) return false;
    if (element.paused) return false;

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
    const gate = decideCrossfade({
      crossfading: isCrossfading(),
      bypassed: bypass.isBypassed(),
      outgoingPlaying: deck().isPlaying(),
      durationSeconds: request.durationSeconds,
    });
    if (gate.kind === "refuse") return { kind: "refused", reason: gate.reason };

    const incoming = idleDeck();
    if (!incoming.load(request.vocals, request.instrumental, request.sampleRate, request.videoId ?? null)) {
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
    // Handing back to the outgoing deck is right only while the player is
    // still on the outgoing track. Once our advance has landed, that deck
    // holds the track the listener has already left.
    const advanceLanded = abandoned !== null && deps.playerTrackId() === abandoned;
    if (!advanceLanded) activeDeck = crossfade.outgoingDeck;
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
