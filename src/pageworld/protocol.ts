// -- Isolated to page world audio bridge protocol -----------------------------

import type { StagedKind } from "@/automix/staged-source";

export interface SetMixLevelMessage {
  type: "blk-set-mix-level";
  mixLevel: number;
}

export interface LoadStemsMessage {
  type: "blk-load-stems";
  videoId: string;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

export interface StopStemsMessage {
  type: "blk-stop-stems";
}

// -- Staging the next track --------------------------------------------------

export interface StagedReadyMessage {
  type: "blk-staged-ready";
  videoId: string;
}

export interface RequestStagedDeckMessage {
  type: "blk-request-staged-deck";
  videoId: string;
}

export interface StageDeckMessage {
  type: "blk-stage-deck";
  videoId: string;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

export interface CrossfadeAbortedMessage {
  type: "blk-crossfade-aborted";
  videoId: string | null;
  reason: string;
}

export interface SetCrossfadeMessage {
  type: "blk-set-crossfade";
  seconds: number;
}

export interface SetLoggingMessage {
  type: "blk-set-logging";
  enabled: boolean;
}

export interface CrossfadeStartedMessage {
  type: "blk-crossfade-started";
  videoId: string;
  durationSeconds: number;
  kind?: StagedKind;
}

export type AudioBridgeMessage = SetMixLevelMessage | LoadStemsMessage | StopStemsMessage;

function isFloat32ArrayList(value: unknown): value is Float32Array<ArrayBuffer>[] {
  return Array.isArray(value) && value.every(channel => channel instanceof Float32Array);
}

export function isSetMixLevelMessage(data: unknown): data is SetMixLevelMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-set-mix-level" &&
    typeof (data as { mixLevel?: unknown }).mixLevel === "number"
  );
}

export function isLoadStemsMessage(data: unknown): data is LoadStemsMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-load-stems" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    isFloat32ArrayList((data as { vocals?: unknown }).vocals) &&
    isFloat32ArrayList((data as { instrumental?: unknown }).instrumental) &&
    typeof (data as { sampleRate?: unknown }).sampleRate === "number"
  );
}

export function isStopStemsMessage(data: unknown): data is StopStemsMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "blk-stop-stems";
}

export function isAudioBridgeMessage(data: unknown): data is AudioBridgeMessage {
  return isSetMixLevelMessage(data) || isLoadStemsMessage(data) || isStopStemsMessage(data);
}

export function isStagedReadyMessage(data: unknown): data is StagedReadyMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-staged-ready" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isRequestStagedDeckMessage(data: unknown): data is RequestStagedDeckMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-request-staged-deck" &&
    typeof (data as { videoId?: unknown }).videoId === "string"
  );
}

export function isStageDeckMessage(data: unknown): data is StageDeckMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-stage-deck" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    isFloat32ArrayList((data as { vocals?: unknown }).vocals) &&
    isFloat32ArrayList((data as { instrumental?: unknown }).instrumental) &&
    typeof (data as { sampleRate?: unknown }).sampleRate === "number"
  );
}

export function isCrossfadeAbortedMessage(data: unknown): data is CrossfadeAbortedMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-crossfade-aborted" &&
    typeof (data as { reason?: unknown }).reason === "string"
  );
}

export function isSetCrossfadeMessage(data: unknown): data is SetCrossfadeMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-set-crossfade" &&
    typeof (data as { seconds?: unknown }).seconds === "number"
  );
}

export function isSetLoggingMessage(data: unknown): data is SetLoggingMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-set-logging" &&
    typeof (data as { enabled?: unknown }).enabled === "boolean"
  );
}

function isStagedKindOrAbsent(value: unknown): value is StagedKind | undefined {
  return value === undefined || value === "stems" || value === "mix";
}

export function isCrossfadeStartedMessage(data: unknown): data is CrossfadeStartedMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "blk-crossfade-started" &&
    typeof (data as { videoId?: unknown }).videoId === "string" &&
    typeof (data as { durationSeconds?: unknown }).durationSeconds === "number" &&
    isStagedKindOrAbsent((data as { kind?: unknown }).kind)
  );
}
