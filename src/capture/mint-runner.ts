import { pickMintedUrl } from "@/acquisition/minted-url";
import { isAdPlaying } from "@/capture/ad-state";
import type { MintedUrlMessage } from "@/capture/bridge-protocol";
import { settledFrameDuration } from "@/capture/frame-duration";
import { log, logError } from "@/capture/log";
import type { UrlCollector } from "@/capture/url-tap";
import { getYtPlayer, readPlayerDuration, suppressAutoAdvance } from "@/capture/yt-player";

const POLL_MS = 250;
const GIVE_UP_MS = 180_000;
const PLAY_RETRY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function anyVideo(doc: Document): HTMLVideoElement | null {
  return doc.querySelector("video");
}

function nudgePlayback(video: HTMLVideoElement): void {
  void video.play().catch(error => log(`play rejected in the minting frame: ${String(error)}`));
}

async function runMintCapture(collector: UrlCollector, videoId: string): Promise<void> {
  const startedAt = Date.now();
  let lastPlayAttempt = 0;
  let sawAd = false;
  let suppressed = false;

  while (Date.now() - startedAt < GIVE_UP_MS) {
    await sleep(POLL_MS);

    const video = anyVideo(document);
    if (video) {
      if (Date.now() - lastPlayAttempt > PLAY_RETRY_MS && video.paused) {
        lastPlayAttempt = Date.now();
        nudgePlayback(video);
      }
      const player = getYtPlayer(document);
      if (player && !suppressed) {
        suppressed = true;
        suppressAutoAdvance(player);
      }

      const adPlaying = isAdPlaying(document);
      if (adPlaying && !sawAd) {
        sawAd = true;
        log("the minting frame landed on an advertisement, waiting for the track");
      }

      const duration = settledFrameDuration(adPlaying, readPlayerDuration(player), video.duration);
      if (duration > 0) {
        const minted = pickMintedUrl(collector.seen(), duration);
        if (minted) {
          const message: MintedUrlMessage = {
            type: "blk-minted-url",
            videoId,
            url: minted.url,
            trackDurationSeconds: duration,
          };
          window.parent.postMessage(message, window.location.origin);
          log(
            `minted a url for videoId=${videoId} in ${Date.now() - startedAt} ms: itag ${minted.itag}, ` +
              `${minted.contentLengthBytes} bytes, ${minted.durationSeconds.toFixed(1)}s of a ${duration.toFixed(1)}s track`
          );
          return;
        }
      }
    }
  }

  logError(
    `the minting frame for videoId=${videoId} gave up after ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
    new Error(`saw ${collector.count()} media urls, none describing the track`)
  );
}

export { runMintCapture };
