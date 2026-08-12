import { allAt, bytesAt, messageAt, readMessage } from "@/acquisition/protobuf";
import type { ProtoField } from "@/acquisition/protobuf";

// -- Describing a VideoPlaybackAbrRequest somebody else built --------------------

interface DescribedField {
  number: number;
  wire: number;
  varint: string | null;
  byteLength: number | null;
}

interface DescribedRequest {
  ok: boolean;
  reason: string;
  totalBytes: number;
  topLevel: DescribedField[];
  clientAbrState: DescribedField[];
  streamerContext: DescribedField[];
  clientInfo: DescribedField[];
  bufferedRangeCount: number;
  ustreamerConfigBytes: number | null;
  poTokenBytes: number | null;
  playbackCookieBytes: number | null;
}

const CLIENT_ABR_STATE = 1;
const BUFFERED_RANGE = 3;
const USTREAMER_CONFIG = 5;
const STREAMER_CONTEXT = 19;
const CLIENT_INFO = 1;
const PO_TOKEN = 2;
const PLAYBACK_COOKIE = 3;

function describeFields(fields: readonly ProtoField[]): DescribedField[] {
  return fields.map(field => ({
    number: field.number,
    wire: field.wire,
    varint: field.varint === null ? null : field.varint.toString(),
    byteLength: field.bytes === null ? null : field.bytes.length,
  }));
}

function empty(reason: string, totalBytes: number): DescribedRequest {
  return {
    ok: false,
    reason,
    totalBytes,
    topLevel: [],
    clientAbrState: [],
    streamerContext: [],
    clientInfo: [],
    bufferedRangeCount: 0,
    ustreamerConfigBytes: null,
    poTokenBytes: null,
    playbackCookieBytes: null,
  };
}

function describeAbrRequest(body: Uint8Array): DescribedRequest {
  let fields: ProtoField[];
  try {
    fields = readMessage(body);
  } catch (error) {
    return empty(error instanceof Error ? error.message : String(error), body.length);
  }
  if (fields.length === 0) return empty("the body decoded to no fields at all", body.length);

  const streamerContext = messageAt(fields, STREAMER_CONTEXT);
  const clientAbrState = messageAt(fields, CLIENT_ABR_STATE);

  return {
    ok: true,
    reason: "decoded",
    totalBytes: body.length,
    topLevel: describeFields(fields),
    clientAbrState: clientAbrState ? describeFields(clientAbrState) : [],
    streamerContext: streamerContext ? describeFields(streamerContext) : [],
    clientInfo: streamerContext ? describeFields(messageAt(streamerContext, CLIENT_INFO) ?? []) : [],
    bufferedRangeCount: allAt(fields, BUFFERED_RANGE).length,
    ustreamerConfigBytes: bytesAt(fields, USTREAMER_CONFIG)?.length ?? null,
    poTokenBytes: streamerContext ? bytesAt(streamerContext, PO_TOKEN)?.length ?? null : null,
    playbackCookieBytes: streamerContext ? bytesAt(streamerContext, PLAYBACK_COOKIE)?.length ?? null : null,
  };
}

// -- What one request carries that another does not -----------------------------

interface FieldDifference {
  where: string;
  number: number;
  theirs: string | null;
  ours: string | null;
}

function describeValue(field: DescribedField | undefined): string | null {
  if (!field) return null;
  return field.varint !== null ? field.varint : `${field.byteLength} bytes`;
}

function diffSection(where: string, theirs: DescribedField[], ours: DescribedField[]): FieldDifference[] {
  const numbers = [...new Set([...theirs, ...ours].map(field => field.number))].sort((a, b) => a - b);
  const differences: FieldDifference[] = [];
  for (const number of numbers) {
    const theirValue = describeValue(theirs.find(field => field.number === number));
    const ourValue = describeValue(ours.find(field => field.number === number));
    if (theirValue !== ourValue) differences.push({ where, number, theirs: theirValue, ours: ourValue });
  }
  return differences;
}

function diffAbrRequests(theirs: DescribedRequest, ours: DescribedRequest): FieldDifference[] {
  return [
    ...diffSection("request", theirs.topLevel, ours.topLevel),
    ...diffSection("clientAbrState", theirs.clientAbrState, ours.clientAbrState),
    ...diffSection("streamerContext", theirs.streamerContext, ours.streamerContext),
    ...diffSection("clientInfo", theirs.clientInfo, ours.clientInfo),
  ];
}

export { describeAbrRequest, diffAbrRequests };
export type { DescribedField, DescribedRequest, FieldDifference };
