import { base64UrlToBytes } from "@/relay/base64";

// -- What a minted url describes -----------------------------------------------

interface MintedStream {
  url: string;
  itag: number;
  lastModified: bigint;
  contentLengthBytes: number;
  durationSeconds: number;
  mimeType: string | null;
  clientName: string | null;
  clientVersion: string | null;
  poToken: Uint8Array | null;
}

const PLAYER_OWNED_PARAMS = ["range", "rn", "rbuf"] as const;

function readNumber(value: string | null): number {
  if (value === null) return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function readMintedUrl(url: string): MintedStream | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith("googlevideo.com")) return null;

  const itag = readNumber(parsed.searchParams.get("itag"));
  const contentLengthBytes = readNumber(parsed.searchParams.get("clen"));
  if (!Number.isInteger(itag) || itag <= 0) return null;
  if (!Number.isInteger(contentLengthBytes) || contentLengthBytes <= 0) return null;

  const lastModified = parsed.searchParams.get("lmt");
  const poToken = parsed.searchParams.get("pot");

  for (const name of PLAYER_OWNED_PARAMS) parsed.searchParams.delete(name);

  return {
    url: parsed.href,
    itag,
    lastModified: lastModified !== null && /^\d+$/.test(lastModified) ? BigInt(lastModified) : 0n,
    contentLengthBytes,
    durationSeconds: readNumber(parsed.searchParams.get("dur")),
    mimeType: parsed.searchParams.get("mime"),
    clientName: parsed.searchParams.get("c"),
    clientVersion: parsed.searchParams.get("cver"),
    poToken: poToken === null ? null : tryDecodeToken(poToken),
  };
}

function tryDecodeToken(token: string): Uint8Array | null {
  try {
    return base64UrlToBytes(token);
  } catch {
    return null;
  }
}

// -- Is this the track, or is it an ad -----------------------------------------

interface MintedJudgement {
  usable: boolean;
  reason: string;
}

const DURATION_TOLERANCE_SECONDS = 3;

function judgeMintedUrl(minted: MintedStream | null, trackDurationSeconds: number): MintedJudgement {
  if (!minted) return { usable: false, reason: "the url describes no stream we can read" };
  if (!Number.isFinite(minted.durationSeconds) || minted.durationSeconds <= 0) {
    return { usable: false, reason: "the url states no duration, so it cannot be told from an ad" };
  }
  if (!Number.isFinite(trackDurationSeconds) || trackDurationSeconds <= 0) {
    return { usable: false, reason: "the track's own length is unknown, so there is nothing to compare against" };
  }
  const shortfall = trackDurationSeconds - minted.durationSeconds;
  if (Math.abs(shortfall) > DURATION_TOLERANCE_SECONDS) {
    return {
      usable: false,
      reason:
        `the url is ${minted.durationSeconds.toFixed(1)}s against a ${trackDurationSeconds.toFixed(1)}s track, ` +
        "which is an advertisement rather than the track",
    };
  }
  return { usable: true, reason: "the url describes the track" };
}

function pickMintedUrl(urls: readonly string[], trackDurationSeconds: number): MintedStream | null {
  for (const url of urls) {
    const minted = readMintedUrl(url);
    if (judgeMintedUrl(minted, trackDurationSeconds).usable) return minted;
  }
  return null;
}

export { DURATION_TOLERANCE_SECONDS, judgeMintedUrl, pickMintedUrl, readMintedUrl };
export type { MintedJudgement, MintedStream };
