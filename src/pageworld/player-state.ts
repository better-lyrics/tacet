import { MOVIE_PLAYER_ELEMENT_ID } from "@/capture/ad-guard";
import { isAdPlaying } from "@/capture/ad-state";
import { readPlayerDuration, readVideoData } from "@/capture/yt-player";
import type { YtPlayer } from "@/capture/yt-player";
import { selectPlaybackElement } from "@/pageworld/select-media-element";
import { chooseTrackDuration, readClockDuration } from "@/pageworld/track-duration";

interface PlayerSnapshot {
  videoId: string;
  durationSeconds: number;
}

function readPlayerSnapshot(
  player: YtPlayer | null,
  clockDurationSeconds = Number.NaN,
  adPlaying = false
): PlayerSnapshot | null {
  if (!player || adPlaying) return null;

  const videoData = readVideoData(player);
  if (!videoData || videoData.isAd === true) return null;
  if (typeof videoData.video_id !== "string" || !videoData.video_id) return null;

  const durationSeconds = chooseTrackDuration(clockDurationSeconds, readPlayerDuration(player));
  if (durationSeconds <= 0) return null;

  return { videoId: videoData.video_id, durationSeconds };
}

function currentPlayerSnapshot(doc: Document): PlayerSnapshot | null {
  const player = doc.getElementById(MOVIE_PLAYER_ELEMENT_ID);
  return readPlayerSnapshot(player ? (player as unknown as YtPlayer) : null, readClockDuration(doc), isAdPlaying(doc));
}

function playerCurrentTime(doc: Document): number {
  const player = doc.getElementById(MOVIE_PLAYER_ELEMENT_ID) as unknown as YtPlayer | null;
  if (!player || typeof player.getCurrentTime !== "function") return Number.NaN;
  try {
    const seconds = player.getCurrentTime();
    return Number.isFinite(seconds) ? seconds : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function playerVideoElement(doc: Document): HTMLVideoElement | null {
  const player = doc.getElementById(MOVIE_PLAYER_ELEMENT_ID);
  if (!player) return null;
  return selectPlaybackElement(Array.from(player.querySelectorAll("video")));
}

export { currentPlayerSnapshot, playerCurrentTime, playerVideoElement, readPlayerSnapshot };
export type { PlayerSnapshot };
