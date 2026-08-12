import { encodeMessage } from "@/acquisition/protobuf";
import type { ProtoInput } from "@/acquisition/protobuf";
import type { FormatId } from "@/acquisition/sabr-parts";

// -- What the request carries ---------------------------------------------------

const AUDIO_ONLY = 1;

const CLIENT_NAME_IDS: Readonly<Record<string, number>> = {
  WEB: 1,
  MWEB: 2,
  ANDROID: 3,
  IOS: 5,
  TVHTML5: 7,
  ANDROID_MUSIC: 21,
  ANDROID_VR: 28,
  WEB_REMIX: 67,
};

function clientIdFor(name: string | null): number {
  if (!name) return CLIENT_NAME_IDS.WEB_REMIX;
  return CLIENT_NAME_IDS[name] ?? CLIENT_NAME_IDS.WEB_REMIX;
}

interface SabrClientInfo {
  clientName: number;
  clientVersion: string;
  osName: string | null;
  osVersion: string | null;
}

interface BufferedRange {
  formatId: FormatId;
  startMilliseconds: number;
  durationMilliseconds: number;
  startSegmentIndex: number;
  endSegmentIndex: number;
}

interface AbrRequestInput {
  format: FormatId;
  ustreamerConfig: Uint8Array | null;
  playerTimeMilliseconds: number;
  bufferedRanges: readonly BufferedRange[];
  formatInitialized: boolean;
  poToken: Uint8Array | null;
  playbackCookie: Uint8Array | null;
  clientInfo: SabrClientInfo;
}

// -- Building it ----------------------------------------------------------------

function formatIdFields(format: FormatId): ProtoInput[] {
  const fields: ProtoInput[] = [
    { number: 1, varint: format.itag },
    { number: 2, varint: format.lastModified },
  ];
  if (format.xtags) fields.push({ number: 3, text: format.xtags });
  return fields;
}

function bufferedRangeFields(range: BufferedRange): ProtoInput[] {
  return [
    { number: 1, message: formatIdFields(range.formatId) },
    { number: 2, varint: Math.max(0, Math.round(range.startMilliseconds)) },
    { number: 3, varint: Math.max(0, Math.round(range.durationMilliseconds)) },
    { number: 4, varint: Math.max(0, Math.round(range.startSegmentIndex)) },
    { number: 5, varint: Math.max(0, Math.round(range.endSegmentIndex)) },
  ];
}

function clientInfoFields(info: SabrClientInfo): ProtoInput[] {
  const fields: ProtoInput[] = [
    { number: 16, varint: info.clientName },
    { number: 17, text: info.clientVersion },
  ];
  if (info.osName) fields.push({ number: 18, text: info.osName });
  if (info.osVersion) fields.push({ number: 19, text: info.osVersion });
  return fields;
}

function streamerContextFields(input: AbrRequestInput): ProtoInput[] {
  const fields: ProtoInput[] = [{ number: 1, message: clientInfoFields(input.clientInfo) }];
  if (input.poToken) fields.push({ number: 2, bytes: input.poToken });
  if (input.playbackCookie) fields.push({ number: 3, bytes: input.playbackCookie });
  return fields;
}

function clientAbrStateFields(input: AbrRequestInput): ProtoInput[] {
  return [
    { number: 28, varint: Math.max(0, Math.round(input.playerTimeMilliseconds)) },
    { number: 40, varint: AUDIO_ONLY },
  ];
}

function buildAbrRequest(input: AbrRequestInput): Uint8Array<ArrayBuffer> {
  const fields: ProtoInput[] = [{ number: 1, message: clientAbrStateFields(input) }];

  if (input.formatInitialized) fields.push({ number: 2, message: formatIdFields(input.format) });
  for (const range of input.bufferedRanges) fields.push({ number: 3, message: bufferedRangeFields(range) });

  if (input.ustreamerConfig) fields.push({ number: 5, bytes: input.ustreamerConfig });
  fields.push({ number: 16, message: formatIdFields(input.format) });
  fields.push({ number: 19, message: streamerContextFields(input) });

  return encodeMessage(fields);
}

function sabrRequestUrl(base: string, requestNumber: number): string {
  const url = new URL(base);
  url.searchParams.set("rn", String(requestNumber));
  return url.href;
}

function withByteRange(base: string, startByte: number, endByteInclusive: number): string {
  const url = new URL(base);
  url.searchParams.set("range", `${Math.max(0, Math.floor(startByte))}-${Math.max(0, Math.floor(endByteInclusive))}`);
  return url.href;
}

export { AUDIO_ONLY, buildAbrRequest, CLIENT_NAME_IDS, clientIdFor, sabrRequestUrl, withByteRange };
export type { AbrRequestInput, BufferedRange, SabrClientInfo };
