// -- Musical time ------------------------------------------------------------

const BEATS_PER_BAR = 4;
const DEFAULT_BARS = 8;

function barsToSeconds(bars: number, bpm: number, beatsPerBar: number = BEATS_PER_BAR): number {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new Error(`transition: bpm must be a positive finite number, got ${bpm}`);
  }
  return (bars * beatsPerBar * 60) / bpm;
}

// -- Crossfade shape ---------------------------------------------------------

const CROSSFADE_CURVE_STEPS = 256;

type FadeDirection = "in" | "out";

type FadeShape = "equal-power" | "equal-gain";

function fadeCurve(steps: number, direction: FadeDirection, shape: FadeShape = "equal-power"): Float32Array {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new Error(`transition: steps must be an integer of at least 2, got ${steps}`);
  }
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const fraction = i / (steps - 1);
    if (shape === "equal-gain") {
      curve[i] = direction === "in" ? fraction : 1 - fraction;
      continue;
    }
    const angle = fraction * 0.5 * Math.PI;
    curve[i] = direction === "in" ? Math.sin(angle) : Math.cos(angle);
  }
  return curve;
}

function equalPowerCurve(steps: number, direction: FadeDirection): Float32Array {
  return fadeCurve(steps, direction, "equal-power");
}

// -- Planning ----------------------------------------------------------------

interface TransitionRequest {
  outgoingDurationSeconds: number;
  outgoingBpm: number;
  bars?: number;
}

type TransitionPlan =
  | { kind: "start"; startSeconds: number; durationSeconds: number }
  | { kind: "refused"; reason: string };

function planTransition(request: TransitionRequest): TransitionPlan {
  const { outgoingDurationSeconds, outgoingBpm, bars = DEFAULT_BARS } = request;
  if (!Number.isFinite(outgoingDurationSeconds) || outgoingDurationSeconds <= 0) {
    throw new Error(`transition: duration must be a positive finite number, got ${outgoingDurationSeconds}`);
  }

  const durationSeconds = barsToSeconds(bars, outgoingBpm);
  const startSeconds = outgoingDurationSeconds - durationSeconds;
  if (startSeconds <= 0) {
    return {
      kind: "refused",
      reason: `a ${durationSeconds.toFixed(2)} s window does not fit a ${outgoingDurationSeconds.toFixed(2)} s track`,
    };
  }

  return { kind: "start", startSeconds, durationSeconds };
}

export {
  BEATS_PER_BAR,
  CROSSFADE_CURVE_STEPS,
  DEFAULT_BARS,
  barsToSeconds,
  equalPowerCurve,
  fadeCurve,
  planTransition,
};
export type { FadeDirection, FadeShape, TransitionPlan, TransitionRequest };
