const WORKER_PARAM = "blk-slice";
const MINT_PARAM = "blk-mint";
const WATCH_URL = "https://music.youtube.com/watch";

interface WorkerAssignment {
  index: number;
  fromSeconds: number;
  toSeconds: number;
}

function buildWorkerUrl(videoId: string, assignment: WorkerAssignment): string {
  const url = new URL(WATCH_URL);
  url.searchParams.set("v", videoId);
  url.searchParams.set(
    WORKER_PARAM,
    `${assignment.index}:${assignment.fromSeconds.toFixed(3)}:${assignment.toSeconds.toFixed(3)}`
  );
  return url.toString();
}

function readWorkerAssignment(search: string): WorkerAssignment | null {
  const raw = new URLSearchParams(search).get(WORKER_PARAM);
  if (!raw) return null;

  const parts = raw.split(":");
  if (parts.length !== 3) return null;

  const [index, fromSeconds, toSeconds] = parts.map(Number);
  if (!Number.isInteger(index) || index < 0) return null;
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds)) return null;
  if (fromSeconds < 0 || toSeconds <= fromSeconds) return null;

  return { index, fromSeconds, toSeconds };
}

function isWorkerFrame(search: string): boolean {
  return readWorkerAssignment(search) !== null;
}

// -- The other job a hidden frame can be given ---------------------------------

function buildMintUrl(videoId: string): string {
  const url = new URL(WATCH_URL);
  url.searchParams.set("v", videoId);
  url.searchParams.set(MINT_PARAM, "1");
  return url.toString();
}

function isMintFrame(search: string): boolean {
  return new URLSearchParams(search).get(MINT_PARAM) === "1";
}

function isHiddenFrame(search: string): boolean {
  return isWorkerFrame(search) || isMintFrame(search);
}

export {
  buildMintUrl,
  buildWorkerUrl,
  isHiddenFrame,
  isMintFrame,
  isWorkerFrame,
  MINT_PARAM,
  readWorkerAssignment,
  WORKER_PARAM,
};
export type { WorkerAssignment };
