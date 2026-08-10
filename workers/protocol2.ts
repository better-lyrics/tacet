import type { Settings } from "../src/settings/settings.js";

// -- Separation control messages ------------------------------------------------------

export interface ModelChoice {
  modelUrl: string;
  modelSha256: string;
}

export interface CancelSeparationCommand {
  type: "blk-cancel-separation";
}

export function isModelChoice(data: unknown): data is ModelChoice {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { modelUrl?: unknown }).modelUrl === "string" &&
    typeof (data as { modelSha256?: unknown }).modelSha256 === "string"
  );
}

export function isCancelSeparationCommand(data: unknown): data is CancelSeparationCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-cancel-separation";
}

// -- Track pipeline messages (real karaoke path) ------------------------------

export type TrackStage =
  | "checking-cache"
  | "decoding"
  | "downloading-model"
  | "loading-model"
  | "separating"
  | "encoding";

export type StemName = "vocals" | "instrumental";

export interface CaptureChunkMessage {
  type: "blk-capture-chunk";
  videoId: string;
  mimeType: string;
  index: number;
  total: number;
  data: string;
}

export interface TrackStageMessage {
  type: "blk-track-stage";
  videoId: string;
  stage: TrackStage;
}

export interface TrackProgressMessage {
  type: "blk-track-progress";
  videoId: string;
  processed: number;
  total: number;
}

export interface StemChunkMessage {
  type: "blk-stem-chunk";
  videoId: string;
  stem: StemName;
  index: number;
  total: number;
  data: string;
}

export interface TrackDoneMessage {
  type: "blk-track-done";
  videoId: string;
}

export interface TrackErrorMessage {
  type: "blk-track-error";
  videoId: string;
  code: string;
  message: string;
}

export function isCaptureChunkMessage(data: unknown): data is CaptureChunkMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-capture-chunk" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { mimeType?: unknown }).mimeType === "string" &&
    typeof (data as { index?: unknown }).index === "number" &&
    typeof (data as { total?: unknown }).total === "number" &&
    typeof (data as { data?: unknown }).data === "string"
  );
}

export function isTrackStageMessage(data: unknown): data is TrackStageMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-stage" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { stage?: unknown }).stage === "string"
  );
}

export function isTrackProgressMessage(data: unknown): data is TrackProgressMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-progress" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { processed?: unknown }).processed === "number" &&
    typeof (data as { total?: unknown }).total === "number"
  );
}

export function isStemChunkMessage(data: unknown): data is StemChunkMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-stem-chunk" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    ((data as { stem?: unknown }).stem === "vocals" || (data as { stem?: unknown }).stem === "instrumental") &&
    typeof (data as { index?: unknown }).index === "number" &&
    typeof (data as { total?: unknown }).total === "number" &&
    typeof (data as { data?: unknown }).data === "string"
  );
}

export function isTrackDoneMessage(data: unknown): data is TrackDoneMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-done" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isTrackErrorMessage(data: unknown): data is TrackErrorMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-track-error" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { code?: unknown }).code === "string" &&
    typeof (data as { message?: unknown }).message === "string"
  );
}

export type TrackPipelineOutboundMessage =
  | CacheHitMessage
  | CacheMissMessage
  | TrackStageMessage
  | TrackProgressMessage
  | StemChunkMessage
  | TrackDoneMessage
  | TrackErrorMessage;

// -- Cache status and clearing (popup) ----------------------------------------

export type CacheClearTarget = "stems" | "model";

export interface GetCacheStatusCommand {
  type: "blk-get-cache-status";
}

export interface CacheStatusMessage {
  type: "blk-cache-status";
  stemCacheBytes: number;
  modelCached: boolean;
  modelCacheBytes: number;
}

export interface ClearStemCacheCommand {
  type: "blk-clear-stem-cache";
}

export interface ClearModelCacheCommand {
  type: "blk-clear-model-cache";
}

export interface ClearCacheResultMessage {
  type: "blk-clear-cache-result";
  target: CacheClearTarget;
  ok: boolean;
  reason?: string;
}

export function isGetCacheStatusCommand(data: unknown): data is GetCacheStatusCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-get-cache-status";
}

export function isCacheStatusMessage(data: unknown): data is CacheStatusMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-cache-status" &&
    typeof (data as { stemCacheBytes?: unknown }).stemCacheBytes === "number" &&
    typeof (data as { modelCached?: unknown }).modelCached === "boolean" &&
    typeof (data as { modelCacheBytes?: unknown }).modelCacheBytes === "number"
  );
}

export function isClearStemCacheCommand(data: unknown): data is ClearStemCacheCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-clear-stem-cache";
}

export function isClearModelCacheCommand(data: unknown): data is ClearModelCacheCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-clear-model-cache";
}

export function isClearCacheResultMessage(data: unknown): data is ClearCacheResultMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-clear-cache-result" &&
    ((data as { target?: unknown }).target === "stems" || (data as { target?: unknown }).target === "model") &&
    typeof (data as { ok?: unknown }).ok === "boolean"
  );
}

// -- Better Lyrics probe (popup -> the tab's fader control) --------------------

export interface HasBetterLyricsCommand {
  type: "blk-has-better-lyrics";
}

export interface BetterLyricsPresenceMessage {
  type: "blk-better-lyrics-presence";
  present: boolean;
}

export function isHasBetterLyricsCommand(data: unknown): data is HasBetterLyricsCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-has-better-lyrics";
}

export function isBetterLyricsPresenceMessage(data: unknown): data is BetterLyricsPresenceMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-better-lyrics-presence" &&
    typeof (data as { present?: unknown }).present === "boolean"
  );
}

// -- Settings relay (offscreen has no chrome.storage) --------------------------

export interface GetSettingsCommand {
  type: "blk-get-settings";
}

export interface SettingsMessage {
  type: "blk-settings";
  settings: Settings;
  model: ModelChoice;
}

export interface SettingsChangedMessage {
  type: "blk-settings-changed";
  settings: Settings;
  model: ModelChoice;
}

export function isGetSettingsCommand(data: unknown): data is GetSettingsCommand {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-get-settings";
}

export function isSettingsMessage(data: unknown): data is SettingsMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-settings" &&
    typeof (data as { settings?: unknown }).settings === "object" &&
    isModelChoice((data as { model?: unknown }).model)
  );
}

export function isSettingsChangedMessage(data: unknown): data is SettingsChangedMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-settings-changed" &&
    typeof (data as { settings?: unknown }).settings === "object" &&
    isModelChoice((data as { model?: unknown }).model)
  );
}

// -- Cache probe --------------------------------------------------------------

export interface ProbeCacheCommand {
  type: "blk-probe-cache";
  videoId: string;
}

export function isProbeCacheCommand(data: unknown): data is ProbeCacheCommand {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-probe-cache" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

// -- Forgetting a track -------------------------------------------------------

export interface ForgetTrackCommand {
  type: "blk-forget-track";
  videoId: string;
}

export function isForgetTrackCommand(data: unknown): data is ForgetTrackCommand {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-forget-track" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export interface CacheHitMessage {
  type: "blk-cache-hit";
  videoId: string;
}

export interface CacheMissMessage {
  type: "blk-cache-miss";
  videoId: string;
}

export function isCacheMissMessage(data: unknown): data is CacheMissMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-cache-miss" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isCacheHitMessage(data: unknown): data is CacheHitMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-cache-hit" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

// -- The relay's guard for everything the offscreen document sends out ---------

const TRACK_PIPELINE_OUTBOUND_GUARDS: Record<TrackPipelineOutboundMessage["type"], (data: unknown) => boolean> = {
  "blk-cache-hit": isCacheHitMessage,
  "blk-cache-miss": isCacheMissMessage,
  "blk-track-stage": isTrackStageMessage,
  "blk-track-progress": isTrackProgressMessage,
  "blk-stem-chunk": isStemChunkMessage,
  "blk-track-done": isTrackDoneMessage,
  "blk-track-error": isTrackErrorMessage,
};

export function isTrackPipelineOutboundMessage(data: unknown): data is TrackPipelineOutboundMessage {
  return Object.values(TRACK_PIPELINE_OUTBOUND_GUARDS).some(guard => guard(data));
}
