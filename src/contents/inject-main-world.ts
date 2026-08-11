import type { PlasmoCSConfig } from "plasmo";
import { analyseOutput } from "@/automix/output-analysis";
import { DECODE_LEAD_SECONDS, decideTransitionCue } from "@/automix/transition-cue";
import type { StagedState } from "@/automix/transition-cue";
import { isAdPlaying } from "@/capture/ad-state";
import { advanceToNextTrack, seekPlayerTo } from "@/capture/yt-player";
import { acquireAudioBus } from "@/pageworld/audio-bus";
import { decideEngagement, reconfirmAfterEmptied } from "@/pageworld/engagement";
import type { EngagementAction, TargetPosition } from "@/pageworld/engagement";
import { startPlayerBridge } from "@/pageworld/player-bridge";
import { createPlaybackGraph } from "@/pageworld/playback-graph";
import type { PlaybackGraph } from "@/pageworld/playback-graph";
import { currentPlayerSnapshot, playerCurrentTime, playerVideoElement } from "@/pageworld/player-state";
import {
  type CrossfadeAbortedMessage,
  type CrossfadeStartedMessage,
  type RequestStagedDeckMessage,
  isLoadStemsMessage,
  isSetCrossfadeMessage,
  isSetMixLevelMessage,
  isStageDeckMessage,
  isStagedReadyMessage,
  isStopStemsMessage,
} from "@/pageworld/protocol";
import { DEFAULT_SETTINGS, isValidCrossfadeSeconds } from "@/settings/settings";
import { createLogger } from "@/shared/logger";

const logger = createLogger("page");

// -- Page-world audio graph --------------------------------------------------

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

const RECONCILE_INTERVAL_MS = 1000;
const ALIGN_DELAY_MS = 250;
const ALIGN_SETTLE_MS = 700;
const ALIGN_MAX_ATTEMPTS = 3;
const ALIGN_TOLERANCE_SECONDS = 0.12;
// A slow advance can take several seconds to empty the element, so this has to
// outlast the fade itself. Measured: one advance emptied 8.3 s after the fade
// began, which is past the end of an 8 s fade.
const OWN_ADVANCE_GRACE_MS = 20_000;

let ownAdvanceUntilMs = 0;
let advancingFromVideoId: string | null = null;

interface LoadedStems {
  videoId: string;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  durationSeconds: number;
}

let cachedGraph: PlaybackGraph | null = null;
let cachedElement: HTMLMediaElement | null = null;
let acquiring: Promise<PlaybackGraph | null> | null = null;
let pendingMixLevel = 1;
let pendingStems: LoadedStems | null = null;
let engagedStems: LoadedStems | null = null;
let lastAction: EngagementAction = "idle";

// Overwritten by blk-set-crossfade the moment the fader mounts, and again on
// every settings change. Read at schedule time, so a change lands on the next
// fade rather than distorting one already in flight.
let crossfadeSeconds = DEFAULT_SETTINGS.crossfadeSeconds;

let stagedVideoId: string | null = null;
let stagedState: StagedState = "none";
let stagedStems: Pick<LoadedStems, "vocals" | "instrumental" | "sampleRate"> | null = null;

logger.log("karaoke page world ready");

function decodedBytes(element: HTMLMediaElement): number {
  return (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
}

function elementForStems(stems: LoadedStems): HTMLMediaElement | null {
  const snapshot = currentPlayerSnapshot(document);
  if (!snapshot || snapshot.videoId !== stems.videoId) return null;
  const element = playerVideoElement(document);
  return element?.isConnected ? element : null;
}

function playerOnOtherTrack(stems: LoadedStems): boolean {
  const snapshot = currentPlayerSnapshot(document);
  return snapshot !== null && snapshot.videoId !== stems.videoId;
}

let awaitingReconfirmation = false;

function reconfirmIfPossible(stems: LoadedStems): void {
  if (!awaitingReconfirmation) return;
  const snapshot = currentPlayerSnapshot(document);
  const element = playerVideoElement(document);
  const decision = reconfirmAfterEmptied({
    playerVideoId: snapshot?.videoId ?? null,
    stemsVideoId: stems.videoId,
    elementDurationSeconds: element?.duration ?? Number.NaN,
    stemDurationSeconds: stems.durationSeconds,
  });
  if (decision === "confirmed") awaitingReconfirmation = false;
}

// A transition moves the stems onto the incoming track before the player gets
// there, and the player can take several seconds to report the new videoId.
// In that window the stems look stale to every check below, get released, and
// the listener drops back to the unseparated track until the pipeline reloads
// them. This is only true while the player is still on the track we faded out
// of, so it cannot swallow a genuine skip.
function advanceStillLanding(): boolean {
  if (Date.now() >= ownAdvanceUntilMs || advancingFromVideoId === null) return false;
  const snapshot = currentPlayerSnapshot(document);
  return snapshot === null || snapshot.videoId === advancingFromVideoId;
}

function stemsAreStale(stems: LoadedStems): boolean {
  if (advanceStillLanding()) return false;
  return awaitingReconfirmation || playerOnOtherTrack(stems);
}

declare global {
  interface Window {
    blkKaraokeProbe: () => unknown;
    blkCrossfadeSelfTest: (fadeSeconds?: number) => Promise<unknown>;
    blkRecordOutput: (seconds?: number) => Promise<unknown>;
    blkRecordEnvelope: (seconds?: number) => Promise<unknown>;
    blkTransitionProbe: () => unknown;
  }
}

// -- Diagnostics --------------------------------------------------------------

window.blkTransitionProbe = () => {
  const state = cachedGraph?.describe() ?? null;
  const active = state ? state.decks[state.activeDeck] : null;
  return {
    crossfadeSeconds,
    stagedVideoId,
    stagedState,
    stagedFrames: stagedStems?.vocals[0]?.length ?? 0,
    engagedVideoId: engagedStems?.videoId ?? null,
    pendingVideoId: pendingStems?.videoId ?? null,
    activeDeck: state?.activeDeck ?? null,
    crossfading: state?.crossfading ?? null,
    remainingSeconds: active ? +(active.durationSeconds - active.positionSeconds).toFixed(2) : null,
    deckPeaks: state ? state.decks.map(deck => +deck.combinedPeak.toFixed(4)) : null,
    deckRms: state ? state.decks.map(deck => [+deck.vocalsRms.toFixed(4), +deck.instrumentalRms.toFixed(4)]) : null,
    deckDurations: state ? state.decks.map(deck => +deck.durationSeconds.toFixed(2)) : null,
    listenerGain: state?.listenerGain ?? null,
    originalGain: state?.originalGain ?? null,
  };
};

window.blkRecordOutput = async (seconds = 12) => {
  const graph = cachedGraph;
  if (!graph) return { error: "no graph" };

  const before = graph.describe();
  const startedAt = performance.now();
  const { samples, sampleRate } = await graph.recordOutput(seconds);
  const after = graph.describe();
  const analysis = analyseOutput(samples, sampleRate);

  return {
    ...analysis,
    envelope: undefined,
    envelopePeak: analysis.envelope.length ? Math.max(...analysis.envelope) : 0,
    envelopeMin: analysis.envelope.length ? Math.min(...analysis.envelope) : 0,
    envelopeWindows: analysis.envelope.length,
    capturedSeconds: +(analysis.frames / sampleRate).toFixed(3),
    wallClockSeconds: +((performance.now() - startedAt) / 1000).toFixed(3),
    sampleRate,
    crossfadingAtStart: before.crossfading,
    crossfadingAtEnd: after.crossfading,
    activeDeckBefore: before.activeDeck,
    activeDeckAfter: after.activeDeck,
    listenerGain: after.listenerGain,
  };
};

window.blkRecordEnvelope = async (seconds = 12) => {
  const graph = cachedGraph;
  if (!graph) return { error: "no graph" };
  const { samples, sampleRate } = await graph.recordOutput(seconds);
  const analysis = analyseOutput(samples, sampleRate);
  return {
    windowSeconds: analysis.envelopeWindowSeconds,
    envelope: analysis.envelope.map(value => +value.toFixed(5)),
  };
};

window.blkKaraokeProbe = () => {
  const snapshot = currentPlayerSnapshot(document);
  const element = playerVideoElement(document);
  return {
    hasGraph: cachedGraph !== null,
    lastAction,
    adPlaying: isAdPlaying(document),
    acquiring: acquiring !== null,
    targetPosition: pendingStems ? targetPosition(pendingStems) : null,
    stemsPending: pendingStems !== null,
    stemsVideoId: pendingStems?.videoId ?? null,
    stemDurationSeconds: pendingStems ? +pendingStems.durationSeconds.toFixed(2) : null,
    playerVideoId: snapshot?.videoId ?? null,
    playerDurationSeconds: snapshot ? +snapshot.durationSeconds.toFixed(2) : null,
    audibleElementDecodedBytes: cachedElement ? decodedBytes(cachedElement) : 0,
    boundToPlayerElement: cachedElement !== null && cachedElement === element,
    graph: cachedGraph?.describe() ?? null,
  };
};

// -- Crossfade self test -----------------------------------------------------

const SELF_TEST_SECONDS = 60;

function selfTestStems(sampleRate: number, hz: number): Float32Array<ArrayBuffer>[] {
  const frames = Math.floor(sampleRate * SELF_TEST_SECONDS);
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) data[i] = Math.sin(2 * Math.PI * hz * (i / sampleRate)) * 0.25;
    channels.push(data);
  }
  return channels;
}

window.blkCrossfadeSelfTest = async (fadeSeconds = 4) => {
  const element = playerVideoElement(document);
  if (!element) return { error: "no player element" };

  const graph = cachedGraph ?? (await buildGraph(element));
  if (!graph) return { error: "could not acquire the audio bus" };

  const sampleRate = 44100;
  // Crossfade out of whatever is genuinely playing when there is something,
  // so the outgoing deck carries real separated stems rather than a tone.
  const outgoingIsReal = graph.describe().stemsPlaying;
  if (!outgoingIsReal) {
    graph.loadStems(selfTestStems(sampleRate, 220), selfTestStems(sampleRate, 220), sampleRate);
    graph.setMixLevel(1);
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  const before = graph.describe();
  if (!before.stemsPlaying) return { error: "no deck is playing, nothing to fade out of", state: before };
  const result = graph.crossfadeTo({
    vocals: selfTestStems(sampleRate, 330),
    instrumental: selfTestStems(sampleRate, 330),
    sampleRate,
    durationSeconds: fadeSeconds,
    incomingOffsetSeconds: 0,
  });

  const samples: { t: number; gain0: number; gain1: number }[] = [];
  const startedAt = performance.now();
  await new Promise<void>(resolve => {
    const timer = setInterval(() => {
      const state = graph.describe();
      samples.push({
        t: +((performance.now() - startedAt) / 1000).toFixed(3),
        gain0: state.decks[0].deckGain,
        gain1: state.decks[1].deckGain,
      });
      if (performance.now() - startedAt > (fadeSeconds + 1) * 1000) {
        clearInterval(timer);
        resolve();
      }
    }, 40);
  });

  const after = graph.describe();
  const inFade = samples.filter(s => s.t > 0.15 && s.t < fadeSeconds - 0.15);
  const powerError = inFade.map(s => Math.abs(s.gain0 ** 2 + s.gain1 ** 2 - 1));
  return {
    crossfade: result,
    outgoingWasRealSeparatedAudio: outgoingIsReal,
    outgoingInstrumentalRms: before.decks[before.activeDeck].instrumentalRms,
    beforeEngaged: before.engaged,
    beforeStemsPlaying: before.stemsPlaying,
    deckSwapped: before.activeDeck !== after.activeDeck,
    gain0: { first: samples[0]?.gain0 ?? null, last: samples.at(-1)?.gain0 ?? null },
    gain1: { first: samples[0]?.gain1 ?? null, last: samples.at(-1)?.gain1 ?? null },
    worstPowerErrorPct: +((Math.max(...powerError) || 0) * 100).toFixed(2),
    outgoingStillPlaying: after.decks[before.activeDeck].playing,
    incomingPlaying: after.decks[after.activeDeck].playing,
    originalGain: after.originalGain,
    sampleCount: samples.length,
  };
};

// -- Transition into the staged track ----------------------------------------

function clearStaging(): void {
  stagedVideoId = null;
  stagedState = "none";
  stagedStems = null;
}

function postToIsolated(message: RequestStagedDeckMessage | CrossfadeStartedMessage | CrossfadeAbortedMessage): void {
  window.postMessage(message, window.location.origin);
}

// A fade moves the engagement bookkeeping onto the incoming track before the
// player gets there. If it never completes, that has to move back, and the
// ISOLATED world has to stop expecting the track change the fade would have
// caused: otherwise the next natural advance is read as a completed crossfade
// and the pipeline reports engaged with nothing in the deck.
let stemsBeforeCrossfade: LoadedStems | null = null;

function onCrossfadeAborted(videoId: string | null, reason: string): void {
  logger.warn(`unwinding the transition into ${videoId ?? "an unnamed track"}, ${reason}`);
  if (stemsBeforeCrossfade !== null) {
    pendingStems = stemsBeforeCrossfade;
    engagedStems = null;
    stemsBeforeCrossfade = null;
  }
  clearStaging();
  postToIsolated({ type: "blk-crossfade-aborted", videoId, reason });
}

function startCrossfade(graph: PlaybackGraph, startInSeconds: number, fadeSeconds: number): void {
  const videoId = stagedVideoId;
  const stems = stagedStems;
  if (videoId === null || stems === null) return;

  const durationSeconds = (stems.vocals[0]?.length ?? 0) / stems.sampleRate;
  const result = graph.crossfadeTo({
    vocals: stems.vocals,
    instrumental: stems.instrumental,
    sampleRate: stems.sampleRate,
    durationSeconds: fadeSeconds,
    incomingOffsetSeconds: 0,
    startInSeconds,
    videoId,
  });
  clearStaging();

  if (result.kind === "refused") {
    logger.warn(`no transition into ${videoId}, ${result.reason}`);
    return;
  }

  // The deck now carries the next track, so the engagement bookkeeping has to
  // follow it across before the player is told to advance.
  stemsBeforeCrossfade = pendingStems;
  pendingStems = { videoId, ...stems, durationSeconds };
  engagedStems = pendingStems;
  awaitingReconfirmation = false;

  const startsInMs = startInSeconds * 1000;
  setTimeout(() => {
    if (!graph.describe().crossfading) return;
    postToIsolated({ type: "blk-crossfade-started", videoId, durationSeconds: fadeSeconds });
  }, startsInMs);
  setTimeout(
    () => {
      if (!graph.describe().crossfading) return;
      ownAdvanceUntilMs = Date.now() + OWN_ADVANCE_GRACE_MS;
      advancingFromVideoId = currentPlayerSnapshot(document)?.videoId ?? null;
      if (!advanceToNextTrack(document)) logger.warn("the player would not advance, the fade will finish regardless");
    },
    startsInMs + (fadeSeconds / 2) * 1000
  );
  // The incoming deck started at the top of the fade while the player advanced
  // at its midpoint, so the two clocks sit exactly half a fade apart. Left
  // alone that shows up as a scrubber and a lyrics line running behind what is
  // audible, and as a backwards jump the next time any transport event reaches
  // the drift correction. The player's own audio is silenced, so moving its
  // clock to the deck's costs nothing that can be heard.
  setTimeout(() => alignPlayerToDeck(graph, videoId, 0), startsInMs + fadeSeconds * 1000 + ALIGN_DELAY_MS);
}

// A seek takes time to land, and the deck keeps moving while it does, so one
// pass leaves a residue. Two or three converge, and each one is inaudible
// because the player's own audio sits at a gain of zero.
function alignPlayerToDeck(graph: PlaybackGraph, videoId: string, attempt: number, lead = 0): void {
  const snapshot = currentPlayerSnapshot(document);
  if (snapshot?.videoId !== videoId) {
    logger.warn(`not aligning the clocks, the player is on ${snapshot?.videoId ?? "nothing"} rather than ${videoId}`);
    return;
  }

  const state = graph.describe();
  const deckSeconds = state.decks[state.activeDeck].positionSeconds;
  const playerSeconds = playerCurrentTime(document);
  const drift = deckSeconds - playerSeconds;
  if (!Number.isFinite(drift)) {
    logger.warn(`not aligning the clocks, the deck reads ${deckSeconds} against a player at ${playerSeconds}`);
    return;
  }
  if (Math.abs(drift) <= ALIGN_TOLERANCE_SECONDS) {
    if (attempt > 0) logger.log(`clocks aligned after ${attempt} seek(s), ${(drift * 1000).toFixed(0)} ms apart`);
    return;
  }
  if (attempt >= ALIGN_MAX_ATTEMPTS) {
    logger.warn(`giving up aligning the clocks, still ${drift.toFixed(2)} s apart`);
    return;
  }

  // The drift correction must not fight a seek we asked for.
  graph.suppressDriftFor((ALIGN_SETTLE_MS / 1000) * 2);
  logger.log(`aligning the player to the deck, ${drift.toFixed(2)} s behind (attempt ${attempt + 1})`);
  if (!seekPlayerTo(document, deckSeconds + lead)) {
    logger.warn("the player would not seek, its clock stays behind the deck");
    return;
  }
  // Whatever this attempt leaves behind is the seek's own latency, so folding
  // it into the next aim cancels it rather than repeating it.
  setTimeout(() => alignPlayerToDeck(graph, videoId, attempt + 1, lead + drift), ALIGN_SETTLE_MS);
}

function runTransitionCue(graph: PlaybackGraph): boolean {
  if (crossfadeSeconds <= 0) return false;
  const state = graph.describe();
  const active = state.decks[state.activeDeck];
  const cue = decideTransitionCue({
    remainingSeconds: active.durationSeconds - active.positionSeconds,
    fadeSeconds: crossfadeSeconds,
    decodeLeadSeconds: DECODE_LEAD_SECONDS,
    pollIntervalSeconds: RECONCILE_INTERVAL_MS / 1000,
    staged: stagedState,
    crossfading: state.crossfading,
  });

  if (cue.kind === "wait") return state.crossfading;
  if (cue.kind === "skip") {
    logger.warn(`no transition into ${stagedVideoId}, ${cue.reason}`);
    clearStaging();
    return false;
  }
  if (cue.kind === "decode") {
    if (stagedVideoId === null) return false;
    stagedState = "decoding";
    postToIsolated({ type: "blk-request-staged-deck", videoId: stagedVideoId });
    return false;
  }

  startCrossfade(graph, cue.startInSeconds, cue.durationSeconds);
  return true;
}

function discardGraph(): void {
  if (!cachedGraph) return;
  cachedGraph.stopStems();
  // dispose, not just stop: the listeners would keep restarting the sources.
  cachedGraph.dispose();
  cachedGraph = null;
  cachedElement = null;
  engagedStems = null;
}

function applyStems(graph: PlaybackGraph, stems: LoadedStems): void {
  graph.loadStems(stems.vocals, stems.instrumental, stems.sampleRate);
  graph.setMixLevel(pendingMixLevel);
  engagedStems = stems;
  awaitingReconfirmation = false;
  logger.log(`stems playing for videoId=${stems.videoId}, mix level ${pendingMixLevel}`);
}

function buildGraph(element: HTMLMediaElement): Promise<PlaybackGraph | null> {
  return acquireAudioBus(element).then(bus => {
    if (!bus) {
      logger.warn("could not acquire the audio bus, playback is unchanged");
      return null;
    }
    logger.log(`audio bus acquired, context=${bus.context.state}, element decoded bytes=${decodedBytes(bus.element)}`);

    const graph = createPlaybackGraph({ context: bus.context, source: bus.source, onCrossfadeAborted });
    cachedElement = bus.element;

    bus.context.addEventListener("statechange", () => {
      if (bus.context.state === "running") return;
      bus.context
        .resume()
        .catch(error => logger.warn("context resume failed", error))
        .finally(() => {
          if (bus.context.state === "running") {
            logger.log("context recovered, stems still engaged");
            return;
          }
          logger.warn(`context stuck in "${bus.context.state}", bypassing to the original`);
          graph.stopStems();
        });
    });

    cachedGraph = graph;
    return graph;
  });
}

function targetPosition(stems: LoadedStems): TargetPosition {
  const target = elementForStems(stems);
  if (!target) return "none";
  return target === cachedElement ? "same" : "other";
}

function reconcile(): void {
  // A fade owns both decks and the player clock still belongs to the outgoing
  // track, so every engagement judgement below would misread it.
  if (cachedGraph && runTransitionCue(cachedGraph)) return;

  const stems = pendingStems;
  if (!stems) return;

  reconfirmIfPossible(stems);

  const action = decideEngagement({
    hasStems: true,
    graph: cachedGraph ? "bound" : "none",
    boundElementConnected: cachedElement?.isConnected ?? false,
    target: targetPosition(stems),
    acquiring: acquiring !== null,
    stemsEngaged: engagedStems === stems,
    stemsAudible: cachedGraph?.isEngaged() ?? false,
    adPlaying: isAdPlaying(document),
    stemsAreStale: stemsAreStale(stems),
  });
  lastAction = action;

  if (action === "idle" || action === "hold") {
    cachedGraph?.recoverIfStopped();
    return;
  }

  if (action === "release" || action === "suspend") {
    cachedGraph?.stopStems();
    if (action === "release") engagedStems = null;
    return;
  }

  if (action === "resume") {
    cachedGraph?.resumeStems();
    return;
  }

  if (action === "load" && cachedGraph) {
    applyStems(cachedGraph, stems);
    return;
  }

  if (action === "rebind") {
    logger.warn("the element these stems belong to changed, tearing the graph down");
    discardGraph();
    return;
  }

  const target = elementForStems(stems);
  if (!target) return;

  acquiring = buildGraph(target).finally(() => {
    acquiring = null;
  });

  void acquiring.then(graph => {
    if (!graph || pendingStems !== stems) return;
    if (targetPosition(stems) === "other") {
      logger.warn("the audio bus bound a different element than the stems match, leaving it disengaged");
      discardGraph();
      return;
    }
    applyStems(graph, stems);
  });
}

setInterval(reconcile, RECONCILE_INTERVAL_MS);
startPlayerBridge();

document.addEventListener(
  "emptied",
  () => {
    // Reconfirmation exists to catch an element still carrying an ad's media
    // after the player bar has moved on. It is the wrong guard for an advance
    // we asked for ourselves into a track whose stems are already in the deck:
    // element.duration reads partial for a while afterwards, reconfirmation
    // never succeeds, and the stems get released for as long as it takes. That
    // measured as 30 s of unseparated audio after one transition.
    if (cachedGraph?.describe().crossfading || Date.now() < ownAdvanceUntilMs) return;
    awaitingReconfirmation = true;
    reconcile();
  },
  true
);
for (const event of ["loadstart", "play", "playing"]) {
  document.addEventListener(event, reconcile, true);
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;

  if (isSetMixLevelMessage(data)) {
    pendingMixLevel = data.mixLevel;
    cachedGraph?.setMixLevel(data.mixLevel);
    return;
  }

  if (isLoadStemsMessage(data)) {
    const durationSeconds = (data.vocals[0]?.length ?? 0) / data.sampleRate;
    logger.log(
      `load-stems received for videoId=${data.videoId}, sampleRate=${data.sampleRate}, channels=${data.vocals.length}, duration=${durationSeconds.toFixed(1)}s`
    );
    pendingStems = {
      videoId: data.videoId,
      vocals: data.vocals,
      instrumental: data.instrumental,
      sampleRate: data.sampleRate,
      durationSeconds,
    };
    reconcile();
    return;
  }

  if (isSetCrossfadeMessage(data)) {
    if (!isValidCrossfadeSeconds(data.seconds)) {
      logger.warn(`ignoring an out-of-range crossfade length of ${data.seconds}`);
      return;
    }
    crossfadeSeconds = data.seconds;
    if (crossfadeSeconds === 0) clearStaging();
    logger.log(`crossfade set to ${crossfadeSeconds === 0 ? "off" : `${crossfadeSeconds} s`}`);
    return;
  }

  if (isStagedReadyMessage(data)) {
    stagedVideoId = data.videoId;
    stagedState = "encoded";
    stagedStems = null;
    logger.log(`${data.videoId} is staged, a transition into it is possible`);
    return;
  }

  if (isStageDeckMessage(data)) {
    if (data.videoId !== stagedVideoId) return;
    stagedStems = { vocals: data.vocals, instrumental: data.instrumental, sampleRate: data.sampleRate };
    stagedState = "ready";
    logger.log(`${data.videoId} decoded into the idle deck, ready to fade`);
    return;
  }

  if (isStopStemsMessage(data)) {
    clearStaging();
    pendingStems = null;
    engagedStems = null;
    cachedGraph?.stopStems();
  }
});
