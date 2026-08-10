// -- Output analysis ----------------------------------------------------------

// What "the audio is fine" means, as arithmetic over the samples that actually
// reached the destination. Every field is something that has a distinct sound:
// clipping crackles, a discontinuity clicks, a gap drops out, non-finite
// samples read as silence because the encoder turns them into it.

const SILENCE_FLOOR = 0.001;
const CLICK_PERCENTILE = 0.999;
const CLICK_MULTIPLE = 8;
const CLICK_FLOOR = 0.05;

interface OutputAnalysis {
  frames: number;
  peak: number;
  rms: number;
  dcOffset: number;
  nonFinite: number;
  clipped: number;
  maxDelta: number;
  maxDeltaAtSeconds: number;
  clickThreshold: number;
  clicks: number;
  longestSilenceMs: number;
  envelope: number[];
  envelopeWindowSeconds: number;
}

// A click is a single-sample jump far outside the signal's own slew rate, so
// the threshold is read off the signal rather than picked. A 440 Hz sine at
// 48 kHz already steps by 0.058 per sample at full scale, and a fixed threshold
// would call that a defect on bright material and miss a real click on quiet.
function clickThresholdFor(deltas: Float32Array): number {
  if (deltas.length === 0) return CLICK_FLOOR;
  const sorted = Float32Array.from(deltas).sort();
  const percentile = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * CLICK_PERCENTILE))];
  return Math.max(percentile * CLICK_MULTIPLE, CLICK_FLOOR);
}

function analyseOutput(samples: Float32Array, sampleRate: number, envelopeWindowSeconds = 0.05): OutputAnalysis {
  const frames = samples.length;
  const empty: OutputAnalysis = {
    frames: 0,
    peak: 0,
    rms: 0,
    dcOffset: 0,
    nonFinite: 0,
    clipped: 0,
    maxDelta: 0,
    maxDeltaAtSeconds: Number.NaN,
    clickThreshold: CLICK_FLOOR,
    clicks: 0,
    longestSilenceMs: 0,
    envelope: [],
    envelopeWindowSeconds,
  };
  if (frames === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return empty;

  let nonFinite = 0;
  let clipped = 0;
  let peak = 0;
  let sum = 0;
  let sumSquares = 0;
  let maxDelta = 0;
  let maxDeltaAt = -1;
  let silenceRun = 0;
  let longestSilence = 0;

  const deltas = new Float32Array(Math.max(0, frames - 1));
  let previous = Number.NaN;

  for (let i = 0; i < frames; i++) {
    const x = samples[i];
    if (!Number.isFinite(x)) {
      nonFinite++;
      previous = Number.NaN;
      silenceRun = 0;
      continue;
    }

    const magnitude = Math.abs(x);
    if (magnitude > 1) clipped++;
    if (magnitude > peak) peak = magnitude;
    sum += x;
    sumSquares += x * x;

    if (magnitude < SILENCE_FLOOR) {
      silenceRun++;
      if (silenceRun > longestSilence) longestSilence = silenceRun;
    } else silenceRun = 0;

    if (Number.isFinite(previous)) {
      const delta = Math.abs(x - previous);
      deltas[i - 1] = delta;
      if (delta > maxDelta) {
        maxDelta = delta;
        maxDeltaAt = i;
      }
    }
    previous = x;
  }

  const threshold = clickThresholdFor(deltas);
  let clicks = 0;
  for (let i = 0; i < deltas.length; i++) if (deltas[i] > threshold) clicks++;

  const window = Math.max(1, Math.floor(sampleRate * envelopeWindowSeconds));
  const envelope: number[] = [];
  for (let start = 0; start + window <= frames; start += window) {
    let windowSum = 0;
    for (let i = start; i < start + window; i++) {
      const x = samples[i];
      if (Number.isFinite(x)) windowSum += x * x;
    }
    envelope.push(Math.sqrt(windowSum / window));
  }

  const counted = Math.max(1, frames - nonFinite);
  return {
    frames,
    peak,
    rms: Math.sqrt(sumSquares / counted),
    dcOffset: sum / counted,
    nonFinite,
    clipped,
    maxDelta,
    maxDeltaAtSeconds: maxDeltaAt < 0 ? Number.NaN : maxDeltaAt / sampleRate,
    clickThreshold: threshold,
    clicks,
    longestSilenceMs: (longestSilence / sampleRate) * 1000,
    envelope,
    envelopeWindowSeconds,
  };
}

// The envelope an equal-power crossfade of two uncorrelated signals is supposed
// to produce. Comparing against the mean of the two levels instead reads a
// correct fade between a loud and a quiet track as a large dip, which is how
// the first pass of this analysis reported a 27 % defect that was not there.
function predictedCrossfadeEnvelope(rmsBefore: number, rmsAfter: number, windows: number): number[] {
  const predicted: number[] = [];
  for (let i = 0; i < windows; i++) {
    const theta = (windows <= 1 ? 0 : i / (windows - 1)) * 0.5 * Math.PI;
    predicted.push(Math.hypot(rmsBefore * Math.cos(theta), rmsAfter * Math.sin(theta)));
  }
  return predicted;
}

interface EnvelopeDeviation {
  worstUnder: number;
  worstOver: number;
  compared: number;
}

function compareEnvelope(measured: readonly number[], predicted: readonly number[]): EnvelopeDeviation {
  let worstUnder = 1;
  let worstOver = 1;
  let compared = 0;
  const length = Math.min(measured.length, predicted.length);
  for (let i = 0; i < length; i++) {
    if (predicted[i] < 1e-6) continue;
    const ratio = measured[i] / predicted[i];
    if (!Number.isFinite(ratio)) continue;
    compared++;
    if (ratio < worstUnder) worstUnder = ratio;
    if (ratio > worstOver) worstOver = ratio;
  }
  return { worstUnder, worstOver, compared };
}

export { CLICK_FLOOR, SILENCE_FLOOR, analyseOutput, compareEnvelope, predictedCrossfadeEnvelope };
export type { EnvelopeDeviation, OutputAnalysis };
