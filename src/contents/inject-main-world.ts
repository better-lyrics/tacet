import type { PlasmoCSConfig } from "plasmo";
import { fadeCeilingSeconds, remainingForCue } from "@/automix/cue-clock";
import type { CueClockInput } from "@/automix/cue-clock";
import { clampFadeToAudio } from "@/automix/crossfade-gate";
import { advanceDelaySeconds } from "@/automix/fade-plan";
import { analyseOutput } from "@/automix/output-analysis";
import { decideStagedSource, isStagingSpent } from "@/automix/staged-source";
import type { StagedKind } from "@/automix/staged-source";
import { DECODE_LEAD_SECONDS, MINIMUM_FADE_SECONDS, decideTransitionCue } from "@/automix/transition-cue";
import type { StagedState } from "@/automix/transition-cue";
import { isAdPlaying } from "@/capture/ad-state";
import {
  type RequestNextPrefetchMessage,
  type RequestPrefetchedAudioMessage,
  isCaptureReadyMessage,
  isNextTrackMessage,
  isPartialCaptureMessage,
  isPrefetchedAudioMessage,
} from "@/capture/bridge-protocol";
import { advanceToNextTrack, seekPlayerTo } from "@/capture/yt-player";
import { acquireAudioBus } from "@/pageworld/audio-bus";
import { decideEngagement, reconfirmAfterEmptied } from "@/pageworld/engagement";
import type { EngagementAction, TargetPosition } from "@/pageworld/engagement";
import { listenerTrackId } from "@/pageworld/listener-track";
import type { PendingAdvance } from "@/pageworld/listener-track";
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
const OWN_ADVANCE_GRACE_MS = 20_000;
const ORIGINAL_ADVANCE_LEAD_SECONDS = 0.15;
const NEXT_TRACK_ASK_INTERVAL_MS = 5000;
const WARM_NEXT_WITHIN_SECONDS = 120;

let ownAdvanceUntilMs = 0;
let advancingFromVideoId: string | null = null;
let advancingIntoVideoId: string | null = null;

interface LoadedStems {
  kind: "stems";
  videoId: string;
  durationSeconds: number;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

interface LoadedMix {
  kind: "mix";
  videoId: string;
  durationSeconds: number;
  mix: AudioBuffer;
}

type LoadedTrack = LoadedStems | LoadedMix;

let cachedGraph: PlaybackGraph | null = null;
let cachedElement: HTMLMediaElement | null = null;
let acquiring: Promise<PlaybackGraph | null> | null = null;
let pendingMixLevel = 1;
let pendingTrack: LoadedTrack | null = null;
let engagedTrack: LoadedTrack | null = null;
let lastAction: EngagementAction = "idle";

let crossfadeSeconds = DEFAULT_SETTINGS.crossfadeSeconds;

let stagedVideoId: string | null = null;
let stagedState: StagedState = "none";
let stagedKind: StagedKind = "stems";
let stagedStems: Pick<LoadedStems, "vocals" | "instrumental" | "sampleRate"> | null = null;
let stagedMix: AudioBuffer | null = null;

logger.log("karaoke page world ready");

function decodedBytes(element: HTMLMediaElement): number {
  return (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
}

function pendingAdvance(): PendingAdvance | null {
  if (Date.now() >= ownAdvanceUntilMs) return null;
  if (advancingFromVideoId === null || advancingIntoVideoId === null) return null;
  return { fromVideoId: advancingFromVideoId, intoVideoId: advancingIntoVideoId };
}

function playerTrackId(): string | null {
  return listenerTrackId({
    playerVideoId: currentPlayerSnapshot(document)?.videoId ?? null,
    advance: pendingAdvance(),
  });
}

function elementForTrack(track: LoadedTrack): HTMLMediaElement | null {
  if (playerTrackId() !== track.videoId) return null;
  const element = playerVideoElement(document);
  return element?.isConnected ? element : null;
}

function playerOnOtherTrack(track: LoadedTrack): boolean {
  const id = playerTrackId();
  return id !== null && id !== track.videoId;
}

let awaitingReconfirmation = false;

function reconfirmIfPossible(track: LoadedTrack): void {
  if (!awaitingReconfirmation) return;
  const snapshot = currentPlayerSnapshot(document);
  const element = playerVideoElement(document);
  const decision = reconfirmAfterEmptied({
    playerVideoId: snapshot?.videoId ?? null,
    stemsVideoId: track.videoId,
    elementDurationSeconds: element?.duration ?? Number.NaN,
    stemDurationSeconds: track.durationSeconds,
  });
  if (decision === "confirmed") awaitingReconfirmation = false;
}

function advanceStillLanding(): boolean {
  const advance = pendingAdvance();
  if (advance === null) return false;
  const snapshot = currentPlayerSnapshot(document);
  return snapshot === null || snapshot.videoId === advance.fromVideoId;
}

function trackIsStale(track: LoadedTrack): boolean {
  return awaitingReconfirmation || playerOnOtherTrack(track);
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
    stagedKind,
    stagedSeconds: stagedVideoId === null ? null : stagedTrackFor(stagedVideoId)?.durationSeconds ?? null,
    nextTrackVideoId,
    capturedVideoIds: [...capturedVideoIds],
    mixUnavailableVideoIds: [...mixUnavailableVideoIds],
    engagedVideoId: engagedTrack?.videoId ?? null,
    engagedKind: engagedTrack?.kind ?? null,
    pendingVideoId: pendingTrack?.videoId ?? null,
    activeDeck: state?.activeDeck ?? null,
    crossfading: state?.crossfading ?? null,
    outgoingSource: state?.outgoingSource ?? null,
    hasGraph: cachedGraph !== null,
    playerVideoId: playerTrackId(),
    activeDeckTrackId: active?.trackId ?? null,
    audibleTrackMatchesPlayer: active === null ? null : active.playing && active.trackId === playerTrackId(),
    deckTrackIds: state ? state.decks.map(deck => deck.trackId) : null,
    deckKinds: state ? state.decks.map(deck => deck.kind) : null,
    deckFinished: state ? state.decks.map(deck => deck.finished) : null,
    deckPlaying: state ? state.decks.map(deck => deck.playing) : null,
    startRefusedBecause: state?.startRefusedBecause ?? null,
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
    targetPosition: pendingTrack ? targetPosition(pendingTrack) : null,
    stemsPending: pendingTrack !== null,
    stemsVideoId: pendingTrack?.videoId ?? null,
    stemDurationSeconds: pendingTrack ? +pendingTrack.durationSeconds.toFixed(2) : null,
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
  const outgoingIsReal = graph.describe().stemsPlaying;
  if (!outgoingIsReal) {
    graph.loadStems(selfTestStems(sampleRate, 220), selfTestStems(sampleRate, 220), sampleRate, playerTrackId());
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

const MIX_REQUEST_TIMEOUT_MS = 4000;
const REMEMBERED_CAPTURES = 8;

let nextTrackVideoId: string | null = null;
let nextTrackAskedUntilMs = 0;
let mixRequestTimer: number | null = null;
const capturedVideoIds = new Set<string>();
const mixUnavailableVideoIds = new Set<string>();

function cancelMixRequest(): void {
  if (mixRequestTimer === null) return;
  window.clearTimeout(mixRequestTimer);
  mixRequestTimer = null;
}

function clearStaging(): void {
  cancelMixRequest();
  stagedVideoId = null;
  stagedState = "none";
  stagedKind = "stems";
  stagedStems = null;
  stagedMix = null;
}

function postToWindow(
  message:
    | RequestStagedDeckMessage
    | CrossfadeStartedMessage
    | CrossfadeAbortedMessage
    | RequestPrefetchedAudioMessage
    | RequestNextPrefetchMessage
): void {
  window.postMessage(message, window.location.origin);
}

function remember(videoIds: Set<string>, videoId: string): void {
  videoIds.add(videoId);
  while (videoIds.size > REMEMBERED_CAPTURES) {
    const oldest = videoIds.values().next().value;
    if (oldest === undefined) return;
    videoIds.delete(oldest);
  }
}

function rememberCapture(videoId: string): void {
  mixUnavailableVideoIds.delete(videoId);
  remember(capturedVideoIds, videoId);
}

function heldSource(): { videoId: string; kind: StagedKind; state: StagedState } | null {
  if (stagedVideoId === null) return null;
  return { videoId: stagedVideoId, kind: stagedKind, state: stagedState };
}

function requestMixFor(videoId: string): void {
  cancelMixRequest();
  stagedVideoId = videoId;
  stagedKind = "mix";
  stagedState = "decoding";
  stagedStems = null;
  stagedMix = null;

  postToWindow({ type: "blk-request-prefetched-audio", videoId });
  logger.log(`asking for the captured audio of ${videoId}, its stems are not staged`);

  mixRequestTimer = window.setTimeout(() => {
    mixRequestTimer = null;
    if (stagedVideoId !== videoId || stagedKind !== "mix" || stagedState !== "decoding") return;
    remember(mixUnavailableVideoIds, videoId);
    stagedState = "none";
    logger.warn(`no captured audio came back for ${videoId}, it cannot be faded into without stems`);
  }, MIX_REQUEST_TIMEOUT_MS);
}

function releaseSpentStaging(): void {
  if (!isStagingSpent({ stagedVideoId, nextTrackVideoId, listenerVideoId: playerTrackId() })) return;
  logger.log(`releasing the ${stagedKind} staged for ${stagedVideoId}, it is no longer what comes next`);
  clearStaging();
}

function askWhatComesNext(): void {
  const listening = playerTrackId();
  if (listening === null || Date.now() < nextTrackAskedUntilMs) return;

  const remaining = currentPlayerSnapshot(document)?.durationSeconds ?? Number.NaN;
  const position = playerCurrentTime(document);
  if (Number.isFinite(remaining) && Number.isFinite(position) && remaining - position > WARM_NEXT_WITHIN_SECONDS) {
    return;
  }

  nextTrackAskedUntilMs = Date.now() + NEXT_TRACK_ASK_INTERVAL_MS;
  postToWindow({ type: "blk-request-next-prefetch", videoId: listening });
}

function stageMixIfUseful(graph: PlaybackGraph): void {
  if (crossfadeSeconds <= 0) return;
  releaseSpentStaging();
  if (nextTrackVideoId !== null && nextTrackVideoId === playerTrackId()) nextTrackVideoId = null;
  if (nextTrackVideoId === null) askWhatComesNext();

  const videoId = nextTrackVideoId;
  if (videoId === null || videoId === playerTrackId()) return;
  if (!capturedVideoIds.has(videoId) || mixUnavailableVideoIds.has(videoId)) return;

  const remainingSeconds = remainingForCue(cueClock(graph));
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= crossfadeSeconds + DECODE_LEAD_SECONDS) return;

  const choice = decideStagedSource({
    held: heldSource(),
    offered: { videoId, kind: "mix" },
    remainingSeconds,
    fadeSeconds: crossfadeSeconds,
    decodeLeadSeconds: DECODE_LEAD_SECONDS,
  });
  if (choice.kind === "keep") return;

  requestMixFor(videoId);
}

async function acceptPrefetchedAudio(videoId: string, bytes: ArrayBuffer): Promise<void> {
  if (stagedVideoId !== videoId || stagedKind !== "mix" || stagedState !== "decoding") {
    logger.log(`captured audio for ${videoId} arrived after it stopped being the staged track, dropping it`);
    return;
  }
  cancelMixRequest();

  const sampleRate = cachedGraph?.describe().contextSampleRate ?? 48000;
  try {
    const decoded = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(bytes);
    if (stagedVideoId !== videoId || stagedKind !== "mix") return;
    stagedMix = decoded;
    stagedState = "ready";
    logger.log(`${videoId} staged as ${decoded.duration.toFixed(1)} s of unseparated audio, ready to fade`);
  } catch (error) {
    remember(mixUnavailableVideoIds, videoId);
    if (stagedVideoId === videoId && stagedKind === "mix") stagedState = "none";
    logger.warn(`could not decode the captured audio for ${videoId}`, error);
  }
}

let trackBeforeCrossfade: LoadedTrack | null = null;
let transitionTargetVideoId: string | null = null;

let transitionGeneration = 0;

function transitionInFlightInto(): string | null {
  if (cachedGraph?.describe().crossfading !== true) return null;
  return transitionTargetVideoId;
}

function onCrossfadeAborted(videoId: string | null, reason: string): void {
  transitionGeneration++;
  transitionTargetVideoId = null;
  logger.warn(`unwinding the transition into ${videoId ?? "an unnamed track"}, ${reason}`);
  if (videoId !== null && playerTrackId() === videoId) {
    engagedTrack = null;
  } else if (trackBeforeCrossfade !== null) {
    pendingTrack = trackBeforeCrossfade;
    engagedTrack = null;
  }
  trackBeforeCrossfade = null;
  clearStaging();
  postToWindow({ type: "blk-crossfade-aborted", videoId, reason });
}

function stagedTrackFor(videoId: string): LoadedTrack | null {
  if (stagedKind === "mix") {
    if (stagedMix === null) return null;
    return { kind: "mix", videoId, durationSeconds: stagedMix.duration, mix: stagedMix };
  }
  if (stagedStems === null) return null;
  return {
    kind: "stems",
    videoId,
    durationSeconds: (stagedStems.vocals[0]?.length ?? 0) / stagedStems.sampleRate,
    vocals: stagedStems.vocals,
    instrumental: stagedStems.instrumental,
    sampleRate: stagedStems.sampleRate,
  };
}

function startCrossfade(graph: PlaybackGraph, startInSeconds: number, fadeSeconds: number): void {
  const videoId = stagedVideoId;
  if (videoId === null) return;
  const incoming = stagedTrackFor(videoId);
  if (incoming === null) return;

  const outgoingCeiling = graph.describe().outgoingSource === "deck" ? fadeCeilingSeconds(cueClock(graph)) : Number.NaN;
  const audioSeconds = Number.isNaN(outgoingCeiling)
    ? incoming.durationSeconds
    : Math.min(incoming.durationSeconds, outgoingCeiling);
  const clamped = clampFadeToAudio(fadeSeconds, audioSeconds, MINIMUM_FADE_SECONDS);
  if (clamped.kind === "refuse") {
    logger.warn(`no transition into ${videoId}, ${clamped.reason}`);
    clearStaging();
    return;
  }
  if (clamped.seconds !== fadeSeconds) {
    logger.log(`shortening the fade into ${videoId} to ${clamped.seconds.toFixed(1)} s of staged audio`);
  }

  const result = graph.crossfadeTo(
    incoming.kind === "mix"
      ? { mix: incoming.mix, durationSeconds: clamped.seconds, incomingOffsetSeconds: 0, startInSeconds, videoId }
      : {
          vocals: incoming.vocals,
          instrumental: incoming.instrumental,
          sampleRate: incoming.sampleRate,
          durationSeconds: clamped.seconds,
          incomingOffsetSeconds: 0,
          startInSeconds,
          videoId,
        }
  );

  if (result.kind === "refused") {
    logger.warn(`no transition into ${videoId}, ${result.reason}`);
    return;
  }
  clearStaging();

  trackBeforeCrossfade = pendingTrack;
  pendingTrack = incoming;
  engagedTrack = incoming;
  transitionTargetVideoId = videoId;
  awaitingReconfirmation = false;

  const generation = ++transitionGeneration;
  const startsInMs = startInSeconds * 1000;
  setTimeout(() => {
    if (!graph.describe().crossfading) return;
    postToWindow({ type: "blk-crossfade-started", videoId, durationSeconds: clamped.seconds, kind: incoming.kind });
  }, startsInMs);
  const advanceAfterMs = advanceDelaySeconds(result.outgoing, clamped.seconds, ORIGINAL_ADVANCE_LEAD_SECONDS) * 1000;
  setTimeout(() => {
    if (!graph.describe().crossfading) return;
    ownAdvanceUntilMs = Date.now() + OWN_ADVANCE_GRACE_MS;
    advancingFromVideoId = currentPlayerSnapshot(document)?.videoId ?? null;
    advancingIntoVideoId = videoId;
    if (advancingFromVideoId === videoId) {
      logger.log(`the player reached ${videoId} on its own, not advancing it again`);
      return;
    }
    if (!advanceToNextTrack(document)) logger.warn("the player would not advance, the fade will finish regardless");
  }, startsInMs + advanceAfterMs);
  setTimeout(
    () => alignPlayerToDeck(graph, videoId, generation, 0),
    startsInMs + clamped.seconds * 1000 + ALIGN_DELAY_MS
  );
}

function alignPlayerToDeck(graph: PlaybackGraph, videoId: string, generation: number, attempt: number, lead = 0): void {
  if (generation !== transitionGeneration) return;

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

  graph.suppressDriftFor((ALIGN_SETTLE_MS / 1000) * 2);
  logger.log(`aligning the player to the deck, ${drift.toFixed(2)} s behind (attempt ${attempt + 1})`);
  if (!seekPlayerTo(document, deckSeconds + lead)) {
    logger.warn("the player would not seek, its clock stays behind the deck");
    return;
  }
  setTimeout(() => alignPlayerToDeck(graph, videoId, generation, attempt + 1, lead + drift), ALIGN_SETTLE_MS);
}

function cueClock(graph: PlaybackGraph): CueClockInput {
  const state = graph.describe();
  const active = state.decks[state.activeDeck];
  return {
    trackDurationSeconds: currentPlayerSnapshot(document)?.durationSeconds ?? Number.NaN,
    trackPositionSeconds: playerCurrentTime(document),
    deckDurationSeconds: active.durationSeconds,
    deckPositionSeconds: active.positionSeconds,
  };
}

function runTransitionCue(graph: PlaybackGraph): boolean {
  if (crossfadeSeconds <= 0) return false;
  const state = graph.describe();
  if (!state.crossfading && isAdPlaying(document)) return false;
  const cue = decideTransitionCue({
    remainingSeconds: remainingForCue(cueClock(graph)),
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
    postToWindow({ type: "blk-request-staged-deck", videoId: stagedVideoId });
    return false;
  }

  startCrossfade(graph, cue.startInSeconds, cue.durationSeconds);
  return true;
}

function discardGraph(): void {
  if (!cachedGraph) return;
  cachedGraph.stopStems();
  cachedGraph.dispose();
  cachedGraph = null;
  cachedElement = null;
  engagedTrack = null;
}

function applyTrack(graph: PlaybackGraph, track: LoadedTrack): void {
  if (track.kind === "mix") graph.loadMix(track.mix, track.videoId);
  else graph.loadStems(track.vocals, track.instrumental, track.sampleRate, track.videoId);
  graph.setMixLevel(pendingMixLevel);
  engagedTrack = track;
  awaitingReconfirmation = false;
  logger.log(`${track.kind} playing for videoId=${track.videoId}, mix level ${pendingMixLevel}`);
}

function buildGraph(element: HTMLMediaElement): Promise<PlaybackGraph | null> {
  return acquireAudioBus(element).then(bus => {
    if (!bus) {
      logger.warn("could not acquire the audio bus, playback is unchanged");
      return null;
    }
    logger.log(`audio bus acquired, context=${bus.context.state}, element decoded bytes=${decodedBytes(bus.element)}`);

    const graph = createPlaybackGraph({
      context: bus.context,
      source: bus.source,
      playerTrackId,
      ownAdvanceLanding: advanceStillLanding,
      onCrossfadeAborted,
    });
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

function targetPosition(track: LoadedTrack): TargetPosition {
  const target = elementForTrack(track);
  if (!target) return "none";
  return target === cachedElement ? "same" : "other";
}

function tendCrossfadeGraph(): void {
  if (cachedGraph !== null) {
    if (cachedElement?.isConnected) return;
    logger.warn("the element the crossfade graph was bound to went away, tearing it down");
    discardGraph();
    return;
  }
  if (crossfadeSeconds <= 0 || acquiring !== null) return;
  if (playerTrackId() === null || isAdPlaying(document)) return;

  const element = playerVideoElement(document);
  if (!element?.isConnected || decodedBytes(element) === 0) return;

  logger.log("acquiring the audio bus so a crossfade can run without stems");
  acquiring = buildGraph(element).finally(() => {
    acquiring = null;
  });
}

function reconcile(): void {
  if (cachedGraph) {
    stageMixIfUseful(cachedGraph);
    if (runTransitionCue(cachedGraph)) return;
  }

  const track = pendingTrack;
  if (!track) {
    tendCrossfadeGraph();
    return;
  }

  reconfirmIfPossible(track);

  const action = decideEngagement({
    hasStems: true,
    graph: cachedGraph ? "bound" : "none",
    boundElementConnected: cachedElement?.isConnected ?? false,
    target: targetPosition(track),
    acquiring: acquiring !== null,
    stemsEngaged: engagedTrack === track,
    stemsAudible: cachedGraph?.isEngaged() ?? false,
    adPlaying: isAdPlaying(document),
    stemsAreStale: trackIsStale(track),
  });
  lastAction = action;

  if (action === "idle" || action === "hold") {
    cachedGraph?.recoverIfStopped();
    return;
  }

  if (action === "release" || action === "suspend") {
    cachedGraph?.stopStems();
    if (action === "release") engagedTrack = null;
    return;
  }

  if (action === "resume") {
    cachedGraph?.resumeStems();
    return;
  }

  if (action === "load" && cachedGraph) {
    applyTrack(cachedGraph, track);
    return;
  }

  if (action === "rebind") {
    logger.warn("the element these stems belong to changed, tearing the graph down");
    discardGraph();
    return;
  }

  const target = elementForTrack(track);
  if (!target) return;

  acquiring = buildGraph(target).finally(() => {
    acquiring = null;
  });

  void acquiring.then(graph => {
    if (!graph || pendingTrack !== track) return;
    if (targetPosition(track) === "other") {
      logger.warn("the audio bus bound a different element than the stems match, leaving it disengaged");
      discardGraph();
      return;
    }
    applyTrack(graph, track);
  });
}

setInterval(reconcile, RECONCILE_INTERVAL_MS);
startPlayerBridge();

document.addEventListener(
  "emptied",
  () => {
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
    const target = transitionInFlightInto();
    if (target !== null && data.videoId !== target) {
      logger.log(`stems for ${data.videoId} arrived mid transition into ${target}, dropping them`);
      return;
    }
    const durationSeconds = (data.vocals[0]?.length ?? 0) / data.sampleRate;
    logger.log(
      `load-stems received for videoId=${data.videoId}, sampleRate=${data.sampleRate}, channels=${data.vocals.length}, duration=${durationSeconds.toFixed(1)}s`
    );
    pendingTrack = {
      kind: "stems",
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
    const choice = decideStagedSource({
      held: heldSource(),
      offered: { videoId: data.videoId, kind: "stems" },
      remainingSeconds: cachedGraph ? remainingForCue(cueClock(cachedGraph)) : Number.NaN,
      fadeSeconds: crossfadeSeconds,
      decodeLeadSeconds: DECODE_LEAD_SECONDS,
    });
    if (choice.kind === "keep") {
      logger.log(`not staging the stems of ${data.videoId}, ${choice.reason}`);
      return;
    }
    cancelMixRequest();
    stagedVideoId = data.videoId;
    stagedKind = "stems";
    stagedState = "encoded";
    stagedStems = null;
    stagedMix = null;
    logger.log(`${data.videoId} is staged, a transition into it is possible`);
    return;
  }

  if (isStageDeckMessage(data)) {
    if (data.videoId !== stagedVideoId || stagedKind !== "stems") return;
    stagedStems = { vocals: data.vocals, instrumental: data.instrumental, sampleRate: data.sampleRate };
    stagedState = "ready";
    logger.log(`${data.videoId} decoded into the idle deck, ready to fade`);
    return;
  }

  if (isNextTrackMessage(data)) {
    nextTrackVideoId = data.videoId;
    return;
  }

  if (isCaptureReadyMessage(data)) {
    rememberCapture(data.videoId);
    return;
  }

  if (isPartialCaptureMessage(data)) {
    rememberCapture(data.videoId);
    logger.log(
      `${data.videoId} was only captured to ${data.coveredSeconds.toFixed(1)} s of ${data.trackSeconds.toFixed(1)} s, enough to fade into but not to separate`
    );
    return;
  }

  if (isPrefetchedAudioMessage(data)) {
    void acceptPrefetchedAudio(data.videoId, data.bytes);
    return;
  }

  if (isStopStemsMessage(data)) {
    clearStaging();
    pendingTrack = null;
    engagedTrack = null;
    cachedGraph?.stopStems();
  }
});
