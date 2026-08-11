// -- Capture (MAIN world) to fader (ISOLATED world) bridge protocol --------

import type { DownloadSource } from "@/orchestrator/download-tooltip";

export interface RequestCapturedAudioMessage {
  type: "blk-request-captured-audio";
  videoId: string;
}

export interface CapturedAudioMessage {
  type: "blk-captured-audio";
  videoId: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface CapturedAudioUnavailableMessage {
  type: "blk-captured-audio-unavailable";
  videoId: string;
  reason: string;
}

export interface CaptureReadyMessage {
  type: "blk-capture-ready";
  videoId: string;
}

export interface RequestPrefetchMessage {
  type: "blk-request-prefetch";
  videoId: string;
  ahead?: boolean;
  fresh?: boolean;
}

export interface RequestNextPrefetchMessage {
  type: "blk-request-next-prefetch";
  videoId: string;
}

export interface NextTrackMessage {
  type: "blk-next-track";
  videoId: string;
  title?: string | null;
  artist?: string | null;
}

// Sent separately, and possibly seconds later, because resolving a thumbnail
// means loading it. blk-next-track is a retry signal for the prefetch gate, so
// it must not be re-sent just to carry a picture.
export interface NextTrackArtworkMessage {
  type: "blk-next-track-artwork";
  videoId: string;
  artworkUrl: string;
}

export interface CaptureStandDownMessage {
  type: "blk-capture-stand-down";
  videoId: string;
}

export interface DownloadProgressMessage {
  type: "blk-download-progress";
  videoId: string;
  fraction: number;
  // The two are paced by different things and the tooltip must say which.
  source: DownloadSource;
}

export interface SliceCapturedMessage {
  type: "blk-slice-captured";
  videoId: string;
  index: number;
  startSeconds: number;
  reachedSeconds: number;
  trackDurationSeconds: number;
  mimeType: string;
  bytes: ArrayBuffer;
}

export function isSliceCapturedMessage(data: unknown): data is SliceCapturedMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-slice-captured" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    Number.isInteger((data as { index?: unknown }).index) &&
    typeof (data as { startSeconds?: unknown }).startSeconds === "number" &&
    typeof (data as { reachedSeconds?: unknown }).reachedSeconds === "number" &&
    typeof (data as { trackDurationSeconds?: unknown }).trackDurationSeconds === "number" &&
    typeof (data as { mimeType?: unknown }).mimeType === "string" &&
    (data as { bytes?: unknown }).bytes instanceof ArrayBuffer
  );
}

export function isRequestCapturedAudioMessage(data: unknown): data is RequestCapturedAudioMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-captured-audio" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isCapturedAudioMessage(data: unknown): data is CapturedAudioMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-captured-audio" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { mimeType?: unknown }).mimeType === "string" &&
    (data as { bytes?: unknown }).bytes instanceof ArrayBuffer
  );
}

export function isCapturedAudioUnavailableMessage(data: unknown): data is CapturedAudioUnavailableMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-captured-audio-unavailable" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { reason?: unknown }).reason === "string"
  );
}

export function isRequestPrefetchMessage(data: unknown): data is RequestPrefetchMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-prefetch" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isRequestNextPrefetchMessage(data: unknown): data is RequestNextPrefetchMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-next-prefetch" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isNextTrackMessage(data: unknown): data is NextTrackMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-next-track" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isNextTrackArtworkMessage(data: unknown): data is NextTrackArtworkMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-next-track-artwork" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { artworkUrl?: unknown }).artworkUrl === "string"
  );
}

export function isCaptureStandDownMessage(data: unknown): data is CaptureStandDownMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-capture-stand-down" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isCaptureReadyMessage(data: unknown): data is CaptureReadyMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-capture-ready" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isDownloadProgressMessage(data: unknown): data is DownloadProgressMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-download-progress" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { fraction?: unknown }).fraction === "number" &&
    ((data as { source?: unknown }).source === "hidden-player" ||
      (data as { source?: unknown }).source === "listener-playback")
  );
}
