import { bytesAt, numberAt, readMessage, textAt, varintAt } from "@/acquisition/protobuf";
import { readUmpVarint } from "@/acquisition/ump";

// -- What the server says back --------------------------------------------------

interface FormatId {
  itag: number;
  lastModified: bigint;
  xtags: string | null;
}

interface MediaHeader {
  headerId: number;
  videoId: string | null;
  formatId: FormatId | null;
  startRangeBytes: number;
  contentLengthBytes: number | null;
  isInitSegment: boolean;
  sequenceNumber: number | null;
  startMilliseconds: number | null;
  durationMilliseconds: number | null;
}

interface FormatInitialization {
  videoId: string | null;
  formatId: FormatId | null;
  mimeType: string | null;
  endSegmentNumber: number | null;
  durationUnits: number | null;
  durationTimescale: number | null;
}

interface SabrErrorReport {
  type: string | null;
  code: number | null;
}

interface NextRequestPolicy {
  backoffMilliseconds: number | null;
  playbackCookie: Uint8Array | null;
}

// -- Decoding -------------------------------------------------------------------

function readFormatId(payload: Uint8Array | null): FormatId | null {
  if (!payload) return null;
  const fields = readMessage(payload);
  const itag = numberAt(fields, 1);
  if (itag === null) return null;
  return { itag, lastModified: varintAt(fields, 2) ?? 0n, xtags: textAt(fields, 3) };
}

function readMediaHeader(payload: Uint8Array): MediaHeader {
  const fields = readMessage(payload);
  return {
    headerId: numberAt(fields, 1) ?? 0,
    videoId: textAt(fields, 2),
    formatId: readFormatId(bytesAt(fields, 13)),
    startRangeBytes: numberAt(fields, 6) ?? 0,
    contentLengthBytes: numberAt(fields, 14),
    isInitSegment: numberAt(fields, 8) === 1,
    sequenceNumber: numberAt(fields, 9),
    startMilliseconds: numberAt(fields, 11),
    durationMilliseconds: numberAt(fields, 12),
  };
}

function readFormatInitialization(payload: Uint8Array): FormatInitialization {
  const fields = readMessage(payload);
  return {
    videoId: textAt(fields, 1),
    formatId: readFormatId(bytesAt(fields, 2)),
    mimeType: textAt(fields, 5),
    endSegmentNumber: numberAt(fields, 4),
    durationUnits: numberAt(fields, 9),
    durationTimescale: numberAt(fields, 10),
  };
}

function readSabrRedirect(payload: Uint8Array): string | null {
  return textAt(readMessage(payload), 1);
}

function readSabrError(payload: Uint8Array): SabrErrorReport {
  const fields = readMessage(payload);
  return { type: textAt(fields, 1), code: numberAt(fields, 2) };
}

function readProtectionStatus(payload: Uint8Array): number | null {
  return numberAt(readMessage(payload), 1);
}

function readNextRequestPolicy(payload: Uint8Array): NextRequestPolicy {
  const fields = readMessage(payload);
  return { backoffMilliseconds: numberAt(fields, 4), playbackCookie: bytesAt(fields, 7) };
}

function splitMediaPayload(payload: Uint8Array): { headerId: number; media: Uint8Array } | null {
  const id = readUmpVarint(payload, 0);
  if (!id) return null;
  return { headerId: id.value, media: payload.subarray(id.next) };
}

function totalDurationMilliseconds(initialization: FormatInitialization): number | null {
  const { durationUnits, durationTimescale } = initialization;
  if (durationUnits === null || !durationTimescale) return null;
  return (durationUnits / durationTimescale) * 1000;
}

export {
  readFormatId,
  readFormatInitialization,
  readMediaHeader,
  readNextRequestPolicy,
  readProtectionStatus,
  readSabrError,
  readSabrRedirect,
  splitMediaPayload,
  totalDurationMilliseconds,
};
export type { FormatId, FormatInitialization, MediaHeader, NextRequestPolicy, SabrErrorReport };
