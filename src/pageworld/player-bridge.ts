import { BETTER_LYRICS_PLAYER_EVENT } from "@/orchestrator/player-source";
import { currentPlayerSnapshot } from "@/pageworld/player-state";
import type { PlayerSnapshot } from "@/pageworld/player-state";

// -- Player bridge -----------------------------------------------------------

const PUBLISH_INTERVAL_MS = 1000;

const MEDIA_EVENTS = [
  "loadedmetadata",
  "durationchange",
  "play",
  "playing",
  "pause",
  "waiting",
  "seeking",
  "seeked",
  "ratechange",
  "ended",
  "emptied",
];

interface PlayerStateMessage {
  type: "blk-player-state";
  videoId: string;
  durationSeconds: number;
}

interface PublishInput {
  snapshot: PlayerSnapshot | null;
  betterLyricsPublishing: boolean;
}

function shouldPublishPlayerState(input: PublishInput): boolean {
  if (input.betterLyricsPublishing) return false;
  return input.snapshot !== null;
}

function startPlayerBridge(): () => void {
  let betterLyricsPublishing = false;

  function publish(): void {
    const snapshot = currentPlayerSnapshot(document);
    if (!shouldPublishPlayerState({ snapshot, betterLyricsPublishing })) return;
    if (snapshot === null) return;
    const message: PlayerStateMessage = {
      type: "blk-player-state",
      videoId: snapshot.videoId,
      durationSeconds: snapshot.durationSeconds,
    };
    window.postMessage(message, window.location.origin);
  }

  function onBetterLyrics(): void {
    if (betterLyricsPublishing) return;
    betterLyricsPublishing = true;
    console.log("[Tacet][page] Better Lyrics is publishing player state, standing our bridge down");
  }

  document.addEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyrics);
  for (const event of MEDIA_EVENTS) document.addEventListener(event, publish, true);
  const timer = window.setInterval(publish, PUBLISH_INTERVAL_MS);
  publish();

  return () => {
    clearInterval(timer);
    document.removeEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyrics);
    for (const event of MEDIA_EVENTS) document.removeEventListener(event, publish, true);
  };
}

export { shouldPublishPlayerState, startPlayerBridge };
export type { PublishInput };
