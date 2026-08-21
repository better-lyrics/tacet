const MIN_MIX_LEVEL = 0;
const MAX_MIX_LEVEL = 1;
const NEUTRAL_MIX_LEVEL = MAX_MIX_LEVEL;
const INSTRUMENTAL_GAIN = 1;

const MIX_GLIDE_SECONDS = 0.3;

interface StemGains {
  vocalsGain: number;
  instrumentalGain: number;
}

function clampMixLevel(mixLevel: number): number {
  if (Number.isNaN(mixLevel)) {
    throw new Error(`gain-law: mixLevel must be a number, got NaN`);
  }
  return Math.max(MIN_MIX_LEVEL, Math.min(MAX_MIX_LEVEL, mixLevel));
}

function gainsForMixLevel(mixLevel: number): StemGains {
  return { vocalsGain: clampMixLevel(mixLevel), instrumentalGain: INSTRUMENTAL_GAIN };
}

function faderArmed(mixLevel: number): boolean {
  return mixLevel !== NEUTRAL_MIX_LEVEL;
}

function listenerGain(volume: number, muted: boolean): number {
  if (muted) return 0;
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

export {
  MIN_MIX_LEVEL,
  MAX_MIX_LEVEL,
  NEUTRAL_MIX_LEVEL,
  INSTRUMENTAL_GAIN,
  MIX_GLIDE_SECONDS,
  clampMixLevel,
  faderArmed,
  gainsForMixLevel,
  listenerGain,
};
export type { StemGains };
