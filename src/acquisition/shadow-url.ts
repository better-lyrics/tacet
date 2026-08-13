import { readMintedUrl } from "@/acquisition/minted-url";
import type { MintedStream } from "@/acquisition/minted-url";

// -- Which of a shadow player's urls is worth pulling ----------------------------

const COLD_START_TOKEN_BYTES = 16;

const ATTESTED_TOKEN_BYTES = 40;

interface ShadowTarget {
  itag: number;
  contentLengthBytes: number | null;
}

interface ShadowJudgement {
  usable: boolean;
  reason: string;
}

function tokenBytes(minted: MintedStream): number {
  return minted.poToken?.byteLength ?? 0;
}

function judgeShadowUrl(minted: MintedStream | null, target: ShadowTarget): ShadowJudgement {
  if (!minted) return { usable: false, reason: "the url describes no stream we can read" };
  if (minted.itag !== target.itag) {
    return { usable: false, reason: `the url is itag ${minted.itag} rather than ${target.itag}` };
  }
  if (target.contentLengthBytes !== null && minted.contentLengthBytes !== target.contentLengthBytes) {
    return {
      usable: false,
      reason: `the url is ${minted.contentLengthBytes} bytes against the ${target.contentLengthBytes} we asked for`,
    };
  }
  const bytes = tokenBytes(minted);
  if (bytes === 0) return { usable: false, reason: "the url carries no token, so it will be rationed" };
  if (bytes < ATTESTED_TOKEN_BYTES) {
    return { usable: false, reason: `the url carries a ${bytes} byte cold-start token, so it will be rationed` };
  }
  return { usable: true, reason: "the url is the attested one for the track we asked for" };
}

function chooseShadowUrl(urls: readonly string[], target: ShadowTarget): MintedStream | null {
  for (const url of urls) {
    const minted = readMintedUrl(url);
    if (judgeShadowUrl(minted, target).usable) return minted;
  }
  return null;
}

export { ATTESTED_TOKEN_BYTES, COLD_START_TOKEN_BYTES, chooseShadowUrl, judgeShadowUrl };
export type { ShadowJudgement, ShadowTarget };
