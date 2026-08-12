type GlyphKind = "mic" | "note";

const TRACK_HEIGHT_PX = 146;
const CLIP_HEIGHT_PX = TRACK_HEIGHT_PX - 6 - 4;
const THUMB_HEIGHT_PX = 18;
const THUMB_INSET_PERCENT = (THUMB_HEIGHT_PX / 2 / CLIP_HEIGHT_PX) * 100;

const SHADOW_THROW_PX = 3;

const REST = 0.05;
const DRAG_REST_SNAP = 0.07;
const KARAOKE_THRESHOLD = 0.97;

const KEY_STEP = 0.05;
const KEY_STEP_SHIFT = 0.2;

const HOLD_MS = 450;
const VIEWPORT_EDGE_PX = 8;
const CARD_GAP_PX = 8;

const DOCK_GLYPH_PX = 16;
const BAR_GLYPH_PX = 24;

function glyphSizeFor(host: "dock" | "bar"): number {
  return host === "bar" ? BAR_GLYPH_PX : DOCK_GLYPH_PX;
}

const LABEL_HIDE_MS = 900;
const LABEL_EXIT_FALLBACK_MS = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// -- Commit side: the logical value the user has set -------------------------

interface CommitFrame {
  effectiveValue: number;
  label: string;
  mixLevel: number;
}

function computeCommit(v: number): CommitFrame {
  const effectiveValue = v >= -REST ? 0 : clamp(v, -1, 0);
  return {
    effectiveValue,
    label: labelForValue(effectiveValue),
    mixLevel: mixLevelFromValue(effectiveValue),
  };
}

function labelForValue(v: number): string {
  if (v <= -KARAOKE_THRESHOLD) return "Karaoke";
  if (v < -REST) return "Vocals down";
  return "Original";
}

function mixLevelFromValue(v: number): number {
  return v + 1;
}

function valueFromPointerOffset(clientY: number, trackTop: number, trackHeight: number): number {
  const value = clamp(-((clientY - trackTop) / trackHeight), -1, 0);
  return value >= -DRAG_REST_SNAP ? 0 : value;
}

function stepValue(v: number, direction: 1 | -1, big: boolean): number {
  const step = big ? KEY_STEP_SHIFT : KEY_STEP;
  return clamp(v + direction * step, -1, 0);
}

// -- Paint side: the springed, visible position -------------------------------

interface PaintFrame {
  shown: number;
  thumbCenterPercent: number;
  fillTopPercent: number;
  fillHeightPercent: number;
  shadowYPx: number;
  glyphKind: GlyphKind;
  glyphFraction: number;
}

function computePaintFrame(x: number): PaintFrame {
  const shown = clamp(x, -1, 0);
  const level = Math.abs(shown);
  const edge = level * 100;
  const centre = clamp(edge, THUMB_INSET_PERCENT, 100 - THUMB_INSET_PERCENT);

  return {
    shown,
    thumbCenterPercent: centre,
    fillTopPercent: edge,
    fillHeightPercent: 100 - edge,
    shadowYPx: ((50 - centre) / (50 - THUMB_INSET_PERCENT)) * SHADOW_THROW_PX,
    glyphKind: level > REST ? "note" : "mic",
    glyphFraction: Math.round(level * 20) / 20,
  };
}

export {
  TRACK_HEIGHT_PX,
  CLIP_HEIGHT_PX,
  THUMB_HEIGHT_PX,
  THUMB_INSET_PERCENT,
  SHADOW_THROW_PX,
  REST,
  DRAG_REST_SNAP,
  KARAOKE_THRESHOLD,
  KEY_STEP,
  KEY_STEP_SHIFT,
  HOLD_MS,
  VIEWPORT_EDGE_PX,
  CARD_GAP_PX,
  DOCK_GLYPH_PX,
  BAR_GLYPH_PX,
  glyphSizeFor,
  LABEL_HIDE_MS,
  LABEL_EXIT_FALLBACK_MS,
  computeCommit,
  labelForValue,
  mixLevelFromValue,
  valueFromPointerOffset,
  stepValue,
  computePaintFrame,
};
export type { GlyphKind, CommitFrame, PaintFrame };
