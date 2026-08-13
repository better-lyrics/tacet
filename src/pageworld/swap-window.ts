// -- When the deck should take over from the element ---------------------------

const FRAME_SECONDS = 0.02;

const WORTHWHILE_RATIO = 0.5;

interface SwapWindowInput {
  envelope: readonly number[] | Float32Array;
  frameSeconds: number;
  fromSeconds: number;
  withinSeconds: number;
  fadeSeconds: number;
}

function frameIndex(seconds: number, frameSeconds: number): number {
  return Math.max(0, Math.floor(seconds / frameSeconds));
}

function chooseSwapDelaySeconds(input: SwapWindowInput): number {
  const { envelope, frameSeconds, fromSeconds, withinSeconds, fadeSeconds } = input;
  if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) return 0;
  if (!Number.isFinite(fromSeconds) || fromSeconds < 0) return 0;
  if (!Number.isFinite(withinSeconds) || withinSeconds <= 0) return 0;
  if (!Number.isFinite(fadeSeconds) || fadeSeconds <= 0) return 0;

  const need = Math.max(1, Math.ceil(fadeSeconds / frameSeconds));
  const first = frameIndex(fromSeconds, frameSeconds);
  const last = Math.min(envelope.length, frameIndex(fromSeconds + withinSeconds, frameSeconds) + need);
  if (last - first < need) return 0;

  let runningSum = 0;
  for (let i = first; i < first + need; i++) runningSum += envelope[i] ?? 0;

  let bestSum = runningSum;
  let bestStart = first;
  let searchedSum = runningSum;
  let searchedFrames = need;

  for (let start = first + 1; start + need <= last; start++) {
    runningSum += (envelope[start + need - 1] ?? 0) - (envelope[start - 1] ?? 0);
    searchedSum += envelope[start + need - 1] ?? 0;
    searchedFrames++;
    if (runningSum < bestSum) {
      bestSum = runningSum;
      bestStart = start;
    }
  }

  const bestMean = bestSum / need;
  const searchedMean = searchedSum / Math.max(1, searchedFrames);
  if (searchedMean <= 0 || bestMean > searchedMean * WORTHWHILE_RATIO) return 0;

  return Math.max(0, bestStart * frameSeconds - fromSeconds);
}

export { FRAME_SECONDS, WORTHWHILE_RATIO, chooseSwapDelaySeconds };
export type { SwapWindowInput };
