// -- Capture coverage --------------------------------------------------------

const COVERAGE_TOLERANCE_S = 3;

type CaptureVerdict = "complete" | "short" | "unusable";

interface CaptureCoverage {
  reachedSeconds: number;
  trackDurationSeconds: number;
  byteLength: number;
}

function judgeCapture(coverage: CaptureCoverage): CaptureVerdict {
  if (coverage.byteLength <= 0) return "unusable";
  if (!Number.isFinite(coverage.trackDurationSeconds) || coverage.trackDurationSeconds <= 0) return "unusable";
  if (!Number.isFinite(coverage.reachedSeconds)) return "short";
  return coverage.reachedSeconds >= coverage.trackDurationSeconds - COVERAGE_TOLERANCE_S ? "complete" : "short";
}

function missingSeconds(coverage: CaptureCoverage): number {
  if (!Number.isFinite(coverage.trackDurationSeconds) || !Number.isFinite(coverage.reachedSeconds)) return 0;
  return Math.max(0, coverage.trackDurationSeconds - coverage.reachedSeconds);
}

// -- Holding a capture the mix route can still fade into ---------------------

const MINIMUM_MIX_SECONDS = 30;

function shouldHoldCapture(coverage: CaptureCoverage): boolean {
  const verdict = judgeCapture(coverage);
  if (verdict === "unusable") return false;
  if (verdict === "complete") return true;
  return Number.isFinite(coverage.reachedSeconds) && coverage.reachedSeconds >= MINIMUM_MIX_SECONDS;
}

// -- Retrying a short capture ------------------------------------------------

const MAX_AHEAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 3000;
const RETRY_MAX_DELAY_MS = 60_000;

type CaptureNextStep = "retry" | "give-up";

function decideRetry(attemptsSoFar: number, isAhead: boolean): CaptureNextStep {
  if (!isAhead) return "retry";
  return attemptsSoFar < MAX_AHEAD_ATTEMPTS ? "retry" : "give-up";
}

function retryDelayMs(attemptsSoFar: number): number {
  const exponent = Math.max(0, attemptsSoFar - 1);
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** exponent);
}

export {
  judgeCapture,
  missingSeconds,
  shouldHoldCapture,
  decideRetry,
  retryDelayMs,
  COVERAGE_TOLERANCE_S,
  MINIMUM_MIX_SECONDS,
  MAX_AHEAD_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
};
export type { CaptureCoverage, CaptureVerdict, CaptureNextStep };
