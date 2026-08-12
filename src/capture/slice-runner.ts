import type { CaptureAccumulator } from "@/capture/accumulator";
import { isAdPlaying } from "@/capture/ad-state";
import type { SliceCapturedMessage } from "@/capture/bridge-protocol";
import { concatenateChunks, countInitSegments, planFirstPlusMedia } from "@/capture/decode-plan";
import { bufferedRangeEnd, bufferedRangeStart, decideHop } from "@/capture/edge-hopper";
import { frameTrackDuration } from "@/capture/frame-duration";
import { log, logError } from "@/capture/log";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { callSafely, getYtPlayer, readPlayerDuration, suppressAutoAdvance } from "@/capture/yt-player";
import type { WorkerAssignment } from "@/capture/worker-frame";

const POLL_MS = 300;
const PLAYER_READY_TIMEOUT_MS = 60_000;
const PLAYER_READY_CAP_MS = 300_000;
const PLAYER_POLL_MS = 500;

const END_OF_TRACK_GUARD_S = 15;

const DURATION_CHANGE_S = 2;

const MAX_RESTARTS = 2;

const TAIL_SETTLE_MS = 4000;

const PLAYBACK_INIT_TIMEOUT_MS = 8000;
const SEEK_CONFIRM_ATTEMPTS = 6;
const SEEK_TOLERANCE_S = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function audibleVideo(doc: Document): HTMLVideoElement | null {
  const candidates = Array.from(doc.querySelectorAll("video"));
  return (
    candidates.find(
      candidate =>
        ((candidate as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0) >
        0
    ) ??
    candidates[0] ??
    null
  );
}

async function waitForPlayer(): Promise<HTMLVideoElement | null> {
  const startedAt = Date.now();
  let deadline = startedAt + PLAYER_READY_TIMEOUT_MS;
  while (Date.now() < deadline && Date.now() - startedAt < PLAYER_READY_CAP_MS) {
    await sleep(PLAYER_POLL_MS);
    if (isAdPlaying(document)) {
      deadline = Date.now() + PLAYER_READY_TIMEOUT_MS;
      continue;
    }
    const video = audibleVideo(document);
    if (video && Number.isFinite(video.duration) && video.duration > 0) return video;
  }
  return null;
}

async function runSliceCapture(
  accumulator: CaptureAccumulator,
  assignment: WorkerAssignment,
  videoId: string
): Promise<void> {
  const video = await waitForPlayer();
  if (!video) {
    logError(`worker slice ${assignment.index} gave up: no usable player`, new Error("player never became ready"));
    return;
  }

  video.muted = true;
  video.loop = true;

  const player = getYtPlayer(document);
  if (player) suppressAutoAdvance(player);

  const trackDuration = (): number => frameTrackDuration(readPlayerDuration(player), video.duration);

  let duration = trackDuration();
  let sliceEnd = Math.min(assignment.toSeconds, duration);
  const seekTo = (seconds: number): void => {
    const target = Math.max(0, Math.min(seconds, duration - 0.1));
    if (player && typeof player.seekTo === "function") {
      callSafely("seekTo", () => player.seekTo?.(target, true));
      return;
    }
    try {
      video.currentTime = target;
    } catch (error) {
      log(`seek to ${target.toFixed(1)}s rejected, the next poll retries: ${String(error)}`);
    }
  };
  const stopPlayback = (): void => {
    if (player && typeof player.pauseVideo === "function") {
      callSafely("pauseVideo", () => player.pauseVideo?.());
      return;
    }
    try {
      video.pause();
    } catch (error) {
      log(`pause rejected, the buffered edge keeps growing regardless: ${String(error)}`);
    }
  };

  void video.play().catch(error => log(`play rejected in the worker frame: ${String(error)}`));
  const initDeadline = Date.now() + PLAYBACK_INIT_TIMEOUT_MS;
  while (Date.now() < initDeadline && video.buffered.length === 0) await sleep(200);
  stopPlayback();

  if (assignment.fromSeconds > 0) {
    seekTo(assignment.fromSeconds);
    for (let attempt = 0; attempt < SEEK_CONFIRM_ATTEMPTS; attempt++) {
      await sleep(300);
      if (Math.abs(video.currentTime - assignment.fromSeconds) < SEEK_TOLERANCE_S) break;
      seekTo(assignment.fromSeconds);
    }
  }
  await sleep(400);

  const startSeconds = bufferedRangeStart(video.buffered, assignment.fromSeconds);
  let cursor = assignment.fromSeconds;
  let stalls = 0;
  let reached = assignment.fromSeconds;
  let restarts = 0;

  while (true) {
    await sleep(POLL_MS);
    if (!video.paused) stopPlayback();

    if (getVideoIdFromSearch(window.location.search) !== videoId) {
      log(`worker slice ${assignment.index} lost its frame to a navigation, sending what it has`);
      break;
    }

    if (restarts < MAX_RESTARTS && accumulator.keepFromLastInitSegment()) {
      restarts++;
      log(`worker slice ${assignment.index} saw the stream re-initialise, restarting from the new header`);
      cursor = assignment.fromSeconds;
      reached = assignment.fromSeconds;
      stalls = 0;
      seekTo(assignment.fromSeconds);
      continue;
    }

    const seen = trackDuration();
    if (seen > 0 && Math.abs(seen - duration) > DURATION_CHANGE_S) {
      log(
        `worker slice ${assignment.index} saw the duration change ${duration.toFixed(1)}s to ${seen.toFixed(1)}s, restarting`
      );
      accumulator.discardRetained();
      duration = seen;
      sliceEnd = Math.min(assignment.toSeconds, duration);
      cursor = assignment.fromSeconds;
      reached = assignment.fromSeconds;
      stalls = 0;
      continue;
    }

    const reach = Math.max(cursor, bufferedRangeEnd(video.buffered, video.currentTime));
    reached = Math.max(reached, reach);
    const decision = decideHop({
      bufferedEnd: reach,
      cursor,
      sliceEnd,
      trackDuration: duration,
      stalls,
    });

    if (decision.action === "done" || decision.action === "give-up") {
      if (decision.action === "give-up") {
        log(`worker slice ${assignment.index} stalled short of ${sliceEnd.toFixed(1)}s, sending what it has`);
      }
      break;
    }

    if (decision.action === "seek") {
      cursor = decision.cursor;
      stalls = 0;
      seekTo(Math.min(decision.to, duration - END_OF_TRACK_GUARD_S));
    } else if (decision.action === "nudge") {
      stalls++;
      seekTo(decision.to);
    } else {
      stalls++;
    }
  }

  if (sliceEnd >= duration - END_OF_TRACK_GUARD_S) {
    log(`worker slice ${assignment.index} waiting ${TAIL_SETTLE_MS}ms for the track's tail to buffer`);
    await sleep(TAIL_SETTLE_MS);
  }

  const reachedSeconds = Math.max(reached, bufferedRangeEnd(video.buffered, video.currentTime));

  const chunks = accumulator.getChunks();
  if (chunks.length === 0) logError(`worker slice ${assignment.index} captured nothing`, new Error("no chunks"));

  const initSegments = countInitSegments(chunks);
  if (initSegments > 1) {
    log(`worker slice ${assignment.index} saw ${initSegments} initializations, keeping the first`);
  }
  const bytes = chunks.length === 0 ? new Uint8Array(0) : concatenateChunks(planFirstPlusMedia(chunks));
  const message: SliceCapturedMessage = {
    type: "blk-slice-captured",
    videoId,
    index: assignment.index,
    startSeconds,
    reachedSeconds,
    trackDurationSeconds: duration,
    mimeType: accumulator.getStats().mimeTypes[0] ?? "audio/webm",
    bytes: bytes.buffer,
  };
  const byteLength = bytes.byteLength;
  window.parent.postMessage(message, window.location.origin, [bytes.buffer]);
  log(
    `worker slice ${assignment.index} sent ${byteLength} bytes, ${startSeconds.toFixed(1)}s to ${reachedSeconds.toFixed(1)}s of ${duration.toFixed(1)}s`
  );
}

export { runSliceCapture };
