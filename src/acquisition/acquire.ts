import { readMintedUrl } from "@/acquisition/minted-url";
import type { MintedStream } from "@/acquisition/minted-url";
import { driveSabr } from "@/acquisition/sabr-client";
import type { SabrResponseReport, SabrTransport } from "@/acquisition/sabr-client";
import { clientIdFor } from "@/acquisition/sabr-request";

// -- Turning a minted url into a track ------------------------------------------

const DEFAULT_WINDOW_BYTES = 1_048_576;

const FALLBACK_MIME_TYPE = "audio/webm";

interface AcquireInput {
  url: string;
  send?: SabrTransport;
  windowBytes?: number;
  maxRequests?: number;
  onProgress?: (receivedBytes: number, expectedBytes: number) => void;
  onResponse?: (response: SabrResponseReport) => void;
}

interface AcquiredTrack {
  ok: boolean;
  reason: string;
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
  itag: number | null;
  expectedBytes: number;
  requests: number;
  protectionStatus: number | null;
}

function refused(reason: string): AcquiredTrack {
  return {
    ok: false,
    reason,
    bytes: new Uint8Array(),
    mimeType: FALLBACK_MIME_TYPE,
    itag: null,
    expectedBytes: 0,
    requests: 0,
    protectionStatus: null,
  };
}

const fetchTransport: SabrTransport = async (url, body) => {
  const response = await fetch(url, { method: "POST", body });
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
};

async function acquireFromMintedUrl(input: AcquireInput): Promise<AcquiredTrack> {
  const minted: MintedStream | null = readMintedUrl(input.url);
  if (!minted) return refused("that url does not describe a stream we can pull");

  const result = await driveSabr({
    serverAbrStreamingUrl: minted.url,
    ustreamerConfig: null,
    format: { itag: minted.itag, lastModified: minted.lastModified, xtags: null },
    expectedBytes: minted.contentLengthBytes,
    clientInfo: {
      clientName: clientIdFor(minted.clientName),
      clientVersion: minted.clientVersion ?? "",
      osName: null,
      osVersion: null,
    },
    poToken: minted.poToken,
    send: input.send ?? fetchTransport,
    windowBytes: input.windowBytes ?? DEFAULT_WINDOW_BYTES,
    maxRequests: input.maxRequests,
    onProgress: received => input.onProgress?.(received, minted.contentLengthBytes),
    onResponse: input.onResponse,
  });

  return {
    ok: result.ok,
    reason: result.reason,
    bytes: result.media,
    mimeType: minted.mimeType ?? FALLBACK_MIME_TYPE,
    itag: minted.itag,
    expectedBytes: minted.contentLengthBytes,
    requests: result.requests,
    protectionStatus: result.protectionStatus,
  };
}

export { acquireFromMintedUrl, DEFAULT_WINDOW_BYTES };
export type { AcquiredTrack, AcquireInput };
