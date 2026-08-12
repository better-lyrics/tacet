import { base64UrlToBytes } from "@/relay/base64";

// -- What a SABR stream needs to know ------------------------------------------

interface AudioFormat {
  itag: number;
  lastModified: bigint;
  xtags: string | null;
  mimeType: string;
  bitrateBitsPerSecond: number;
  sampleRateHz: number;
  contentLengthBytes: number;
  durationMilliseconds: number;
  isDrc: boolean;
}

interface SabrParameters {
  videoId: string;
  trackDurationSeconds: number;
  serverAbrStreamingUrl: string;
  ustreamerConfig: Uint8Array;
  format: AudioFormat;
}

type SabrParametersResult = { ok: true; parameters: SabrParameters } | { ok: false; reason: string };

// -- Reading a response nobody typed -------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function at(value: unknown, ...path: string[]): unknown {
  let here: unknown = value;
  for (const key of path) {
    const record = asRecord(here);
    if (!record) return undefined;
    here = record[key];
  }
  return here;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function asBigCount(value: unknown): bigint | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

// -- Choosing what to ask for ---------------------------------------------------

function readAudioFormat(value: unknown): AudioFormat | null {
  const mimeType = asText(at(value, "mimeType"));
  if (!mimeType?.startsWith("audio/")) return null;

  const itag = asCount(at(value, "itag"));
  const lastModified = asBigCount(at(value, "lastModified"));
  const contentLengthBytes = asCount(at(value, "contentLength"));
  if (itag === null || lastModified === null || contentLengthBytes === null) return null;

  return {
    itag,
    lastModified,
    xtags: asText(at(value, "xtags")),
    mimeType,
    bitrateBitsPerSecond: asCount(at(value, "bitrate")) ?? asCount(at(value, "averageBitrate")) ?? 0,
    sampleRateHz: asCount(at(value, "audioSampleRate")) ?? 0,
    contentLengthBytes,
    durationMilliseconds: asCount(at(value, "approxDurationMs")) ?? 0,
    isDrc: at(value, "isDrc") === true,
  };
}

function chooseAudioFormat(formats: readonly AudioFormat[]): AudioFormat | null {
  const usable = formats.filter(format => format.contentLengthBytes > 0);
  const plain = usable.filter(format => !format.isDrc);
  const candidates = plain.length > 0 ? plain : usable;
  return candidates.reduce<AudioFormat | null>((best, format) => {
    if (!best) return format;
    if (format.bitrateBitsPerSecond !== best.bitrateBitsPerSecond) {
      return format.bitrateBitsPerSecond > best.bitrateBitsPerSecond ? format : best;
    }
    return format.itag < best.itag ? format : best;
  }, null);
}

function audioFormatsIn(playerResponse: unknown): AudioFormat[] {
  const adaptive = at(playerResponse, "streamingData", "adaptiveFormats");
  if (!Array.isArray(adaptive)) return [];
  return adaptive.map(readAudioFormat).filter((format): format is AudioFormat => format !== null);
}

// -- The one reader every caller goes through ----------------------------------

function readSabrParameters(playerResponse: unknown): SabrParametersResult {
  const status = asText(at(playerResponse, "playabilityStatus", "status"));
  if (status !== null && status !== "OK") return { ok: false, reason: `playability status is ${status}` };

  const videoId = asText(at(playerResponse, "videoDetails", "videoId"));
  if (!videoId) return { ok: false, reason: "the response names no videoId" };

  const serverAbrStreamingUrl = asText(at(playerResponse, "streamingData", "serverAbrStreamingUrl"));
  if (!serverAbrStreamingUrl) return { ok: false, reason: "the response carries no serverAbrStreamingUrl" };

  const configText = asText(
    at(
      playerResponse,
      "playerConfig",
      "mediaCommonConfig",
      "mediaUstreamerRequestConfig",
      "videoPlaybackUstreamerConfig"
    )
  );
  if (!configText) return { ok: false, reason: "the response carries no videoPlaybackUstreamerConfig" };

  const formats = audioFormatsIn(playerResponse);
  const format = chooseAudioFormat(formats);
  if (!format) {
    return { ok: false, reason: `none of the ${formats.length} audio formats is usable` };
  }

  let ustreamerConfig: Uint8Array;
  try {
    ustreamerConfig = base64UrlToBytes(configText);
  } catch (error) {
    return { ok: false, reason: `the ustreamer config is not base64: ${error}` };
  }

  return {
    ok: true,
    parameters: {
      videoId,
      trackDurationSeconds: asCount(at(playerResponse, "videoDetails", "lengthSeconds")) ?? 0,
      serverAbrStreamingUrl,
      ustreamerConfig,
      format,
    },
  };
}

export { audioFormatsIn, chooseAudioFormat, readSabrParameters };
export type { AudioFormat, SabrParameters, SabrParametersResult };
