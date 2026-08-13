// -- When the deck should take over from the element ---------------------------

// The handover is a change of signal, not a change of level: separation error,
// Opus and a resample all sit between the element's audio and the deck's, so the
// two are correlated rather than identical. A linear crossfade of two signals
// that are not identical dips at its midpoint, by up to 3 dB when they are
// uncorrelated, and whatever spectral difference there is arrives as a brief
// glitch. Neither can be curved away, because both come from the signals rather
// than the gains.
//
// Both scale with the level of the music, though. Swapping where the track is
// quiet makes an artifact that is proportionally identical inaudible in absolute
// terms, so the lever that works is choosing the moment.

const FRAME_SECONDS = 0.02;

// A window has to beat the surrounding music by enough to be worth waiting for.
// Below this the wait buys nothing and the handover may as well happen now.
const WORTHWHILE_RATIO = 0.5;

interface SwapWindowInput {
  // RMS per FRAME_SECONDS of the audio the deck is about to play.
  envelope: readonly number[] | Float32Array;
  frameSeconds: number;
  fromSeconds: number;
  withinSeconds: number;
  fadeSeconds: number;
}

function frameIndex(seconds: number, frameSeconds: number): number {
  return Math.max(0, Math.floor(seconds / frameSeconds));
}

// The quietest run of frames long enough to hold the whole fade, or null when
// nothing in reach is quiet enough to be worth deferring for.
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

  // Compared against the music around it rather than an absolute threshold, so
  // this works on a quiet track as well as a loud one.
  const bestMean = bestSum / need;
  const searchedMean = searchedSum / Math.max(1, searchedFrames);
  if (searchedMean <= 0 || bestMean > searchedMean * WORTHWHILE_RATIO) return 0;

  return Math.max(0, bestStart * frameSeconds - fromSeconds);
}

export { FRAME_SECONDS, WORTHWHILE_RATIO, chooseSwapDelaySeconds };
export type { SwapWindowInput };
