// -- Capture (MAIN world) to fader (ISOLATED world) bridge protocol --------

import { isSourceId } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";
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

export interface RequestPrefetchedAudioMessage {
  type: "blk-request-prefetched-audio";
  videoId: string;
}

export interface PrefetchedAudioMessage {
  type: "blk-prefetched-audio";
  videoId: string;
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

export interface PartialCaptureMessage {
  type: "blk-partial-capture";
  videoId: string;
  coveredSeconds: number;
  trackSeconds: number;
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
}

export interface RequestQueueTracksMessage {
  type: "blk-request-queue-tracks";
}

export interface QueueTrackNames {
  videoId: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
}

export interface QueueTracksMessage {
  type: "blk-queue-tracks";
  now: QueueTrackNames | null;
  next: QueueTrackNames | null;
}

export interface TrackArtworkMessage {
  type: "blk-track-artwork";
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

export interface RequestShadowUrlMessage {
  type: "blk-request-shadow-url";
  videoId: string;
}

export interface AcquisitionResultMessage {
  type: "blk-acquisition-result";
  videoId: string;
  source: SourceId;
  url: string | null;
  reason: string;
}

export function isRequestShadowUrlMessage(data: unknown): data is RequestShadowUrlMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-shadow-url" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isAcquisitionResultMessage(data: unknown): data is AcquisitionResultMessage {
  if (typeof data !== "object" || data === null) return false;
  const url: unknown = (data as { url?: unknown }).url;
  return (
    (data as { type?: unknown }).type === "blk-acquisition-result" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    isSourceId((data as { source?: unknown }).source) &&
    (url === null || (typeof url === "string" && url.length > 0)) &&
    typeof (data as { reason?: unknown }).reason === "string"
  );
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

export function isRequestPrefetchedAudioMessage(data: unknown): data is RequestPrefetchedAudioMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-prefetched-audio" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isPrefetchedAudioMessage(data: unknown): data is PrefetchedAudioMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-prefetched-audio" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
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

export function isRequestQueueTracksMessage(data: unknown): data is RequestQueueTracksMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-request-queue-tracks";
}

function isQueueTrackNames(value: unknown): value is QueueTrackNames | null {
  if (value === null) return true;
  return typeof value === "object" && typeof (value as { videoId?: unknown }).videoId === "string";
}

export function isQueueTracksMessage(data: unknown): data is QueueTracksMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-queue-tracks" &&
    isQueueTrackNames((data as { now?: unknown }).now) &&
    isQueueTrackNames((data as { next?: unknown }).next)
  );
}

export function isTrackArtworkMessage(data: unknown): data is TrackArtworkMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-artwork" &&
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

export function isPartialCaptureMessage(data: unknown): data is PartialCaptureMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-partial-capture" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { coveredSeconds?: unknown }).coveredSeconds === "number" &&
    typeof (data as { trackSeconds?: unknown }).trackSeconds === "number"
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
