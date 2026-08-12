import {
  readFormatInitialization,
  readMediaHeader,
  readNextRequestPolicy,
  readProtectionStatus,
  readSabrError,
  readSabrRedirect,
  splitMediaPayload,
} from "@/acquisition/sabr-parts";
import type { FormatId, SabrErrorReport } from "@/acquisition/sabr-parts";
import { buildAbrRequest, sabrRequestUrl, withByteRange } from "@/acquisition/sabr-request";
import type { BufferedRange, SabrClientInfo } from "@/acquisition/sabr-request";
import { UMP_PART, joinBytes, readUmp } from "@/acquisition/ump";
import type { UmpPart } from "@/acquisition/ump";

// -- What we know so far --------------------------------------------------------

interface Segment {
  headerId: number;
  startRangeBytes: number;
  sequenceNumber: number | null;
  durationMilliseconds: number;
  isInitSegment: boolean;
  chunks: Uint8Array[];
  bytes: number;
  ended: boolean;
}

interface SabrState {
  formatInitialized: boolean;
  playbackCookie: Uint8Array | null;
  redirectUrl: string | null;
  protectionStatus: number | null;
  error: SabrErrorReport | null;
  reloadRequested: boolean;
  endOfTrack: boolean;
  backoffMilliseconds: number | null;
  segments: Map<number, Segment>;
}

function emptyState(): SabrState {
  return {
    formatInitialized: false,
    playbackCookie: null,
    redirectUrl: null,
    protectionStatus: null,
    error: null,
    reloadRequested: false,
    endOfTrack: false,
    backoffMilliseconds: null,
    segments: new Map(),
  };
}

// -- Folding one response into it -----------------------------------------------

function applyPart(state: SabrState, part: UmpPart): void {
  switch (part.type) {
    case UMP_PART.formatInitializationMetadata: {
      readFormatInitialization(part.payload);
      state.formatInitialized = true;
      return;
    }
    case UMP_PART.mediaHeader: {
      const header = readMediaHeader(part.payload);
      const existing = state.segments.get(header.headerId);
      const segment: Segment = existing ?? {
        headerId: header.headerId,
        startRangeBytes: header.startRangeBytes,
        sequenceNumber: header.sequenceNumber,
        durationMilliseconds: header.durationMilliseconds ?? 0,
        isInitSegment: header.isInitSegment,
        chunks: [],
        bytes: 0,
        ended: false,
      };
      segment.startRangeBytes = header.startRangeBytes;
      segment.sequenceNumber = header.sequenceNumber;
      segment.durationMilliseconds = header.durationMilliseconds ?? segment.durationMilliseconds;
      state.segments.set(header.headerId, segment);
      return;
    }
    case UMP_PART.media: {
      const split = splitMediaPayload(part.payload);
      if (!split) return;
      const segment = state.segments.get(split.headerId);
      if (!segment) return;
      segment.chunks.push(split.media);
      segment.bytes += split.media.length;
      return;
    }
    case UMP_PART.mediaEnd: {
      const split = splitMediaPayload(part.payload);
      const segment = split ? state.segments.get(split.headerId) : null;
      if (segment) segment.ended = true;
      return;
    }
    case UMP_PART.nextRequestPolicy: {
      const policy = readNextRequestPolicy(part.payload);
      if (policy.playbackCookie) state.playbackCookie = policy.playbackCookie;
      state.backoffMilliseconds = policy.backoffMilliseconds;
      return;
    }
    case UMP_PART.sabrRedirect: {
      state.redirectUrl = readSabrRedirect(part.payload);
      return;
    }
    case UMP_PART.sabrError: {
      state.error = readSabrError(part.payload);
      return;
    }
    case UMP_PART.streamProtectionStatus: {
      state.protectionStatus = readProtectionStatus(part.payload);
      return;
    }
    case UMP_PART.reloadPlayerResponse: {
      state.reloadRequested = true;
      return;
    }
    case UMP_PART.endOfTrack: {
      state.endOfTrack = true;
      return;
    }
    default:
      return;
  }
}

function applyUmpResponse(state: SabrState, body: Uint8Array): { parts: UmpPart[]; gainedBytes: number } {
  const before = receivedBytes(state);
  const { parts } = readUmp(body);
  for (const part of parts) applyPart(state, part);
  return { parts, gainedBytes: receivedBytes(state) - before };
}

// -- Reading the state ----------------------------------------------------------

function orderedSegments(state: SabrState): Segment[] {
  return [...state.segments.values()].sort((left, right) => left.startRangeBytes - right.startRangeBytes);
}

function receivedBytes(state: SabrState): number {
  let total = 0;
  for (const segment of state.segments.values()) total += segment.bytes;
  return total;
}

function downloadedMilliseconds(state: SabrState): number {
  let total = 0;
  for (const segment of state.segments.values()) total += segment.durationMilliseconds;
  return total;
}

function highestSequenceNumber(state: SabrState): number {
  let highest = 0;
  for (const segment of state.segments.values()) {
    if (segment.sequenceNumber !== null) highest = Math.max(highest, segment.sequenceNumber);
  }
  return highest;
}

function bufferedRangesFor(state: SabrState, format: FormatId): BufferedRange[] {
  const duration = downloadedMilliseconds(state);
  if (duration <= 0) return [];
  return [
    {
      formatId: format,
      startMilliseconds: 0,
      durationMilliseconds: duration,
      startSegmentIndex: 1,
      endSegmentIndex: highestSequenceNumber(state),
    },
  ];
}

function assembleMedia(state: SabrState): Uint8Array<ArrayBuffer> {
  return joinBytes(orderedSegments(state).flatMap(segment => segment.chunks));
}

// -- Driving it -----------------------------------------------------------------

interface SabrTransportResult {
  status: number;
  bytes: Uint8Array;
}

type SabrTransport = (url: string, body: Uint8Array<ArrayBuffer>) => Promise<SabrTransportResult>;

interface DriveInput {
  serverAbrStreamingUrl: string;
  ustreamerConfig: Uint8Array | null;
  format: FormatId;
  expectedBytes: number;
  clientInfo: SabrClientInfo;
  poToken: Uint8Array | null;
  send: SabrTransport;
  windowBytes?: number;
  maxRequests?: number;
  onProgress?: (receivedBytes: number, requestNumber: number) => void;
  onResponse?: (response: SabrResponseReport) => void;
}

interface SabrResponseReport {
  requestNumber: number;
  httpStatus: number;
  ranged: boolean;
  parts: string[];
  gainedBytes: number;
  protectionStatus: number | null;
}

interface DriveResult {
  ok: boolean;
  reason: string;
  media: Uint8Array<ArrayBuffer>;
  receivedBytes: number;
  requests: number;
  protectionStatus: number | null;
  sabrError: SabrErrorReport | null;
}

const DEFAULT_MAX_REQUESTS = 200;
const EMPTY_RESPONSES_BEFORE_GIVING_UP = 2;

async function driveSabr(input: DriveInput): Promise<DriveResult> {
  const state = emptyState();
  const maxRequests = input.maxRequests ?? DEFAULT_MAX_REQUESTS;
  let url = input.serverAbrStreamingUrl;
  let requestNumber = 0;
  let emptyResponses = 0;
  let reason = "the request budget ran out";

  while (requestNumber < maxRequests) {
    const body = buildAbrRequest({
      format: input.format,
      ustreamerConfig: input.ustreamerConfig,
      playerTimeMilliseconds: downloadedMilliseconds(state),
      bufferedRanges: bufferedRangesFor(state, input.format),
      formatInitialized: state.formatInitialized,
      poToken: input.poToken,
      playbackCookie: state.playbackCookie,
      clientInfo: input.clientInfo,
    });

    const asked = sabrRequestUrl(url, requestNumber);
    const held = receivedBytes(state);
    const windowed =
      input.windowBytes && input.expectedBytes > 0
        ? withByteRange(asked, held, Math.min(input.expectedBytes, held + input.windowBytes) - 1)
        : asked;

    const sent = await input.send(windowed, body);
    requestNumber += 1;

    if (sent.status !== 200) {
      input.onResponse?.({
        requestNumber,
        httpStatus: sent.status,
        ranged: new URL(windowed).searchParams.has("range"),
        parts: [],
        gainedBytes: 0,
        protectionStatus: state.protectionStatus,
      });
      reason = `the server answered ${sent.status}`;
      break;
    }

    state.redirectUrl = null;
    const { parts, gainedBytes } = applyUmpResponse(state, sent.bytes);
    input.onProgress?.(receivedBytes(state), requestNumber);
    input.onResponse?.({
      requestNumber,
      httpStatus: sent.status,
      ranged: windowed !== asked,
      parts: parts.map(part => part.name),
      gainedBytes,
      protectionStatus: state.protectionStatus,
    });

    if (state.error) {
      reason = `sabr error ${state.error.type ?? "unnamed"} code ${state.error.code ?? "none"}`;
      break;
    }
    if (state.protectionStatus === 3) {
      reason = "the server requires an attestation, so a token is not optional here";
      break;
    }
    if (state.reloadRequested) {
      reason = "the server asked for a fresh player response";
      break;
    }

    if (state.redirectUrl) {
      url = state.redirectUrl;
      continue;
    }

    if (receivedBytes(state) >= input.expectedBytes) {
      reason = "the whole track arrived";
      break;
    }
    if (state.endOfTrack) {
      reason = "the server reported the end of the track";
      break;
    }

    if (gainedBytes === 0) {
      emptyResponses += 1;
      if (emptyResponses >= EMPTY_RESPONSES_BEFORE_GIVING_UP) {
        reason = "the server stopped sending media";
        break;
      }
    } else {
      emptyResponses = 0;
    }
  }

  const media = assembleMedia(state);
  return {
    ok: media.length >= input.expectedBytes && input.expectedBytes > 0,
    reason,
    media,
    receivedBytes: media.length,
    requests: requestNumber,
    protectionStatus: state.protectionStatus,
    sabrError: state.error,
  };
}

export {
  applyUmpResponse,
  assembleMedia,
  bufferedRangesFor,
  downloadedMilliseconds,
  driveSabr,
  emptyState,
  orderedSegments,
  receivedBytes,
};
export type { DriveInput, DriveResult, SabrResponseReport, SabrState, SabrTransport, Segment };
