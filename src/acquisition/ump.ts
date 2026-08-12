// -- Part types ----------------------------------------------------------------

const UMP_PART = {
  onesieHeader: 10,
  onesieData: 11,
  onesieEncryptedMedia: 12,
  mediaHeader: 20,
  media: 21,
  mediaEnd: 22,
  config: 30,
  liveMetadata: 31,
  hostnameChangeHint: 32,
  liveMetadataPromise: 33,
  liveMetadataPromiseCancellation: 34,
  nextRequestPolicy: 35,
  ustreamerVideoAndFormatMetadata: 36,
  formatSelectionConfig: 37,
  ustreamerSelectedMediaStream: 38,
  formatInitializationMetadata: 42,
  sabrRedirect: 43,
  sabrError: 44,
  sabrSeek: 45,
  reloadPlayerResponse: 46,
  playbackStartPolicy: 47,
  allowedCachedFormats: 48,
  startBandwidthSamplingHint: 49,
  pauseBandwidthSamplingHint: 50,
  selectableFormats: 51,
  requestIdentifier: 52,
  requestCancellationPolicy: 53,
  onesiePrefetchRejection: 54,
  timelineContext: 55,
  requestPipelining: 56,
  sabrContextUpdate: 57,
  streamProtectionStatus: 58,
  sabrContextSendingPolicy: 59,
  lawnmowerPolicy: 60,
  sabrAck: 61,
  endOfTrack: 62,
  cacheLoadPolicy: 63,
  lawnmowerMessagingPolicy: 64,
  prewarmConnection: 65,
  playbackDebugInfo: 66,
  snackbarMessage: 67,
  networkTiming: 68,
  cuepointList: 69,
  stitchedRegionsOfInterest: 70,
  stitchedSegmentsMetadataList: 71,
  probeSuccess: 72,
} as const;

const PART_NAMES: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(UMP_PART).map(([name, type]) => [type, name])
);

function umpPartName(type: number): string {
  return PART_NAMES[type] ?? `type-${type}`;
}

// -- The framing ---------------------------------------------------------------

interface UmpPart {
  type: number;
  name: string;
  payload: Uint8Array;
}

interface UmpRead {
  parts: UmpPart[];
  remainder: Uint8Array;
}

function varintWidth(first: number): number {
  if (first < 128) return 1;
  if (first < 192) return 2;
  if (first < 224) return 3;
  if (first < 240) return 4;
  return 5;
}

function readUmpVarint(input: Uint8Array, at: number): { value: number; next: number } | null {
  if (at >= input.length) return null;
  const first = input[at];
  const width = varintWidth(first);
  if (at + width > input.length) return null;
  if (width === 1) return { value: first, next: at + 1 };
  if (width === 5) {
    const view = new DataView(input.buffer, input.byteOffset + at + 1, 4);
    return { value: view.getUint32(0, true), next: at + 5 };
  }
  const keptBits = 8 - width;
  let value = first & ((1 << keptBits) - 1);
  for (let index = 1; index < width; index += 1) {
    value |= input[at + index] << (keptBits + 8 * (index - 1));
  }
  return { value: value >>> 0, next: at + width };
}

function readUmp(input: Uint8Array): UmpRead {
  const parts: UmpPart[] = [];
  let at = 0;
  while (at < input.length) {
    const type = readUmpVarint(input, at);
    if (!type) break;
    const size = readUmpVarint(input, type.next);
    if (!size) break;
    const end = size.next + size.value;
    if (end > input.length) break;
    parts.push({
      type: type.value,
      name: umpPartName(type.value),
      payload: input.subarray(size.next, end),
    });
    at = end;
  }
  return { parts, remainder: input.subarray(at) };
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

export { joinBytes, readUmp, readUmpVarint, umpPartName, UMP_PART };
export type { UmpPart, UmpRead };
