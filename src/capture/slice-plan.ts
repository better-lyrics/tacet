interface SlicePlan {
  index: number;
  fromSeconds: number;
  toSeconds: number;
}

const DEFAULT_WORKER_COUNT = 4;

const MIN_SLICE_SECONDS = 30;

function workerCountFor(durationSeconds: number, maxWorkers: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const affordable = Math.floor(durationSeconds / MIN_SLICE_SECONDS);
  return Math.max(1, Math.min(Math.max(1, Math.floor(maxWorkers)), affordable || 1));
}

function planSlices(durationSeconds: number, maxWorkers: number = DEFAULT_WORKER_COUNT): SlicePlan[] {
  const count = workerCountFor(durationSeconds, maxWorkers);
  if (count === 0) return [];

  const span = durationSeconds / count;
  return Array.from({ length: count }, (_, index) => ({
    index,
    fromSeconds: index * span,
    toSeconds: index === count - 1 ? durationSeconds : (index + 1) * span,
  }));
}

const OPEN_ENDED_SECONDS = 86_400;

function planWholeTrack(): SlicePlan[] {
  return [{ index: 0, fromSeconds: 0, toSeconds: OPEN_ENDED_SECONDS }];
}

export { planSlices, planWholeTrack, workerCountFor, DEFAULT_WORKER_COUNT, MIN_SLICE_SECONDS, OPEN_ENDED_SECONDS };
export type { SlicePlan };
