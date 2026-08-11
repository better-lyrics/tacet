import type { DownloadSource } from "@/orchestrator/download-tooltip";

type KaraokeStatus = "waiting-for-capture" | "ready-to-engage" | "processing" | "engaged" | "failed";

interface KaraokeState {
  status: KaraokeStatus;
  videoId: string;
  stage: string | null;
  processed: number;
  total: number;
  reason: string | null;
  downloadFraction: number;
  downloadSource: DownloadSource | null;
}

type KaraokeEvent =
  | { type: "track-changed"; videoId: string }
  | { type: "crossfaded"; videoId: string }
  | { type: "reacquire"; videoId: string }
  | { type: "capture-ready"; videoId: string }
  | { type: "cache-hit"; videoId: string }
  | { type: "engage"; videoId: string }
  | { type: "stage"; videoId: string; stage: string }
  | { type: "progress"; videoId: string; processed: number; total: number }
  | { type: "download-progress"; videoId: string; fraction: number; source: DownloadSource }
  | { type: "stems-loaded"; videoId: string }
  | { type: "failed"; videoId: string; reason: string };

function initialKaraokeState(videoId: string): KaraokeState {
  return {
    status: "waiting-for-capture",
    videoId,
    stage: null,
    processed: 0,
    total: 0,
    reason: null,
    downloadFraction: Number.NaN,
    downloadSource: null,
  };
}

function reduceKaraokeState(state: KaraokeState, event: KaraokeEvent): KaraokeState {
  if (event.type === "track-changed") {
    return event.videoId === state.videoId ? state : initialKaraokeState(event.videoId);
  }

  if (event.type === "crossfaded") {
    return { ...initialKaraokeState(event.videoId), status: "engaged" };
  }

  if (event.videoId !== state.videoId) return state;

  switch (event.type) {
    case "reacquire":
      return initialKaraokeState(state.videoId);

    case "capture-ready":
      return state.status === "waiting-for-capture" || state.status === "failed"
        ? { ...state, status: "ready-to-engage", reason: null }
        : state;

    case "cache-hit":
      return state.status === "waiting-for-capture"
        ? { ...state, status: "processing", stage: "checking-cache" }
        : state;

    case "engage":
      return state.status === "ready-to-engage" ? { ...state, status: "processing" } : state;

    case "stage":
      return state.status === "processing" ? { ...state, stage: event.stage } : state;

    case "progress":
      return state.status === "processing" ? { ...state, processed: event.processed, total: event.total } : state;

    case "download-progress":
      return state.status === "waiting-for-capture"
        ? { ...state, downloadFraction: event.fraction, downloadSource: event.source }
        : state;

    case "stems-loaded":
      return state.status === "processing" ? { ...state, status: "engaged", reason: null } : state;

    case "failed":
      return { ...state, status: "failed", reason: event.reason };

    default:
      return state;
  }
}

export { initialKaraokeState, reduceKaraokeState };
export type { KaraokeState, KaraokeStatus, KaraokeEvent };
