import {
  BAR_GLYPH_PX,
  CLIP_HEIGHT_PX,
  DOCK_GLYPH_PX,
  DRAG_REST_SNAP,
  KARAOKE_THRESHOLD,
  THUMB_INSET_PERCENT,
  TRACK_HEIGHT_PX,
  computeCommit,
  computePaintFrame,
  glyphSizeFor,
  labelForValue,
  mixLevelFromValue,
  stepValue,
  valueFromPointerOffset,
} from "@/ui/fader-geometry";
import { describe, expect, it } from "vitest";

describe("geometry constants", () => {
  it("pins the concentric measurements exactly as specified", () => {
    expect(TRACK_HEIGHT_PX).toBe(146);
    expect(CLIP_HEIGHT_PX).toBe(136);
    expect(THUMB_INSET_PERCENT).toBeCloseTo(6.617647058823529, 9);
  });
});

describe("glyphSizeFor", () => {
  it("matches Better Lyrics' own dock icons in the dock", () => {
    expect(glyphSizeFor("dock")).toBe(DOCK_GLYPH_PX);
    expect(DOCK_GLYPH_PX).toBe(16);
  });

  it("matches the player bar's own controls in the bar", () => {
    expect(glyphSizeFor("bar")).toBe(BAR_GLYPH_PX);
    expect(BAR_GLYPH_PX).toBe(24);
  });

  describe("regressions", () => {
    it("the two hosts never share a size, so a stale one is always visible", () => {
      expect(glyphSizeFor("dock")).not.toBe(glyphSizeFor("bar"));
    });
  });
});

describe("labelForValue", () => {
  it("happy paths", () => {
    expect(labelForValue(0)).toBe("Original");
    expect(labelForValue(-0.5)).toBe("Vocals down");
    expect(labelForValue(-1)).toBe("Karaoke");
  });

  describe("edge cases", () => {
    it("boundary at exactly -0.97 is Karaoke, just above it is not", () => {
      expect(labelForValue(-0.97)).toBe("Karaoke");
      expect(labelForValue(-0.9699)).toBe("Vocals down");
    });

    it("boundary at exactly -REST reads as Original, not Vocals down", () => {
      expect(labelForValue(-0.05)).toBe("Original");
      expect(labelForValue(-0.0501)).toBe("Vocals down");
    });
  });

  describe("regressions", () => {
    it("no value anywhere in the range is named for raising the vocal", () => {
      for (let i = 0; i <= 200; i++) {
        expect(labelForValue(-i / 200)).not.toBe("Vocals up");
      }
    });
  });
});

describe("computeCommit", () => {
  it("happy paths", () => {
    expect(computeCommit(0)).toEqual({ effectiveValue: 0, label: "Original", mixLevel: 1 });
    expect(computeCommit(-1)).toEqual({ effectiveValue: -1, label: "Karaoke", mixLevel: 0 });
    expect(computeCommit(-0.5)).toEqual({ effectiveValue: -0.5, label: "Vocals down", mixLevel: 0.5 });
  });

  describe("edge cases", () => {
    it("rounds anything within REST of Original down to exactly 0", () => {
      expect(computeCommit(-0.03).effectiveValue).toBe(0);
      expect(computeCommit(-0.05).effectiveValue).toBe(0);
      expect(computeCommit(-0.0501).effectiveValue).toBe(-0.0501);
    });

    it("clamps a value that has overshot past Karaoke", () => {
      expect(computeCommit(-1.4).effectiveValue).toBe(-1);
    });
  });

  describe("regressions", () => {
    it("a positive value can never survive as a boost", () => {
      expect(computeCommit(1).effectiveValue).toBe(0);
      expect(computeCommit(0.5).effectiveValue).toBe(0);
      expect(computeCommit(1).mixLevel).toBe(1);
    });
  });

  describe("invariants", () => {
    it("never emits a mixLevel outside the 0..1 contract", () => {
      for (let i = -30; i <= 30; i++) {
        const { mixLevel } = computeCommit(i / 20);
        expect(mixLevel).toBeGreaterThanOrEqual(0);
        expect(mixLevel).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("mixLevelFromValue", () => {
  it("maps -1..0 onto the 0..1 contract the control emits, 1 is untouched", () => {
    expect(mixLevelFromValue(-1)).toBe(0);
    expect(mixLevelFromValue(-0.5)).toBe(0.5);
    expect(mixLevelFromValue(0)).toBe(1);
  });
});

describe("valueFromPointerOffset", () => {
  const trackTop = 100;
  const trackHeight = 146;

  it("happy paths: top of the track is Original, bottom is Karaoke", () => {
    expect(valueFromPointerOffset(trackTop, trackTop, trackHeight)).toBe(0);
    expect(valueFromPointerOffset(trackTop + trackHeight, trackTop, trackHeight)).toBe(-1);
    expect(valueFromPointerOffset(trackTop + trackHeight / 2, trackTop, trackHeight)).toBeCloseTo(-0.5, 9);
  });

  describe("edge cases", () => {
    it("clamps to the travel range past either end", () => {
      expect(valueFromPointerOffset(trackTop - 500, trackTop, trackHeight)).toBe(0);
      expect(valueFromPointerOffset(trackTop + trackHeight + 500, trackTop, trackHeight)).toBe(-1);
    });

    it("snaps to exactly 0 inside the dead zone at the Original rail", () => {
      const y = trackTop + trackHeight * (DRAG_REST_SNAP / 2);
      expect(valueFromPointerOffset(y, trackTop, trackHeight)).toBe(0);
    });

    it("does not snap just outside the dead zone", () => {
      const y = trackTop + trackHeight * (DRAG_REST_SNAP + 0.01);
      expect(valueFromPointerOffset(y, trackTop, trackHeight)).not.toBe(0);
    });
  });

  describe("invariants", () => {
    it("never returns a value outside -1..0 for any pointer position", () => {
      for (let i = -50; i <= 250; i++) {
        const value = valueFromPointerOffset(trackTop + (trackHeight * i) / 200, trackTop, trackHeight);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(0);
      }
    });
  });
});

describe("stepValue", () => {
  it("happy paths", () => {
    expect(stepValue(-0.5, 1, false)).toBeCloseTo(-0.45, 10);
    expect(stepValue(-0.5, -1, false)).toBeCloseTo(-0.55, 10);
    expect(stepValue(-0.5, 1, true)).toBeCloseTo(-0.3, 10);
    expect(stepValue(-0.5, -1, true)).toBeCloseTo(-0.7, 10);
  });

  describe("edge cases", () => {
    it("clamps at the travel limits instead of overshooting", () => {
      expect(stepValue(-0.02, 1, true)).toBe(0);
      expect(stepValue(-0.98, -1, true)).toBe(-1);
      expect(stepValue(0, 1, false)).toBe(0);
      expect(stepValue(-1, -1, false)).toBe(-1);
    });
  });

  describe("regressions", () => {
    it("stepping up from Original cannot reach a boost", () => {
      let value = 0;
      for (let i = 0; i < 10; i++) value = stepValue(value, 1, true);
      expect(value).toBe(0);
    });
  });
});

describe("computePaintFrame", () => {
  it("happy paths", () => {
    const original = computePaintFrame(0);
    expect(original.thumbCenterPercent).toBeCloseTo(THUMB_INSET_PERCENT, 9);
    expect(original.fillTopPercent).toBe(0);
    expect(original.fillHeightPercent).toBe(100);
    expect(original.glyphKind).toBe("mic");
    expect(original.glyphFraction).toBe(0);

    const karaoke = computePaintFrame(-1);
    expect(karaoke.thumbCenterPercent).toBeCloseTo(100 - THUMB_INSET_PERCENT, 9);
    expect(karaoke.fillTopPercent).toBe(100);
    expect(karaoke.fillHeightPercent).toBe(0);
    expect(karaoke.glyphKind).toBe("note");
    expect(karaoke.glyphFraction).toBe(1);

    const half = computePaintFrame(-0.5);
    expect(half.thumbCenterPercent).toBeCloseTo(50, 9);
    expect(half.fillTopPercent).toBeCloseTo(50, 9);
    expect(half.fillHeightPercent).toBeCloseTo(50, 9);
  });

  describe("edge cases", () => {
    it("clamps a springed value that has overshot past either end", () => {
      expect(computePaintFrame(-1.4)).toEqual(computePaintFrame(-1));
      expect(computePaintFrame(0.09)).toEqual(computePaintFrame(0));
    });

    it("the glyph swap happens exactly at REST of travel, not at 0", () => {
      expect(computePaintFrame(-0.05).glyphKind).toBe("mic");
      expect(computePaintFrame(-0.0501).glyphKind).toBe("note");
    });

    it("throws the shadow the full distance at each rail, and none at the middle", () => {
      expect(computePaintFrame(0).shadowYPx).toBeCloseTo(3, 9);
      expect(computePaintFrame(-1).shadowYPx).toBeCloseTo(-3, 9);
      expect(computePaintFrame(-0.5).shadowYPx).toBeCloseTo(0, 9);
    });
  });

  describe("regressions", () => {
    it("Karaoke leaves the track genuinely empty, with no handle-shaped remnant", () => {
      expect(computePaintFrame(-1).fillHeightPercent).toBe(0);
      expect(computePaintFrame(-0.999).fillHeightPercent).toBeLessThan(0.2);
    });

    it("Original fills the whole clip, so the level never reads as partial at rest", () => {
      expect(computePaintFrame(0).fillHeightPercent).toBe(100);
      expect(computePaintFrame(0).fillTopPercent).toBe(0);
    });

    it("the handle stays inside the clip at both rails", () => {
      for (let i = 0; i <= 200; i++) {
        const frame = computePaintFrame(-i / 200);
        expect(frame.thumbCenterPercent).toBeGreaterThanOrEqual(THUMB_INSET_PERCENT - 1e-9);
        expect(frame.thumbCenterPercent).toBeLessThanOrEqual(100 - THUMB_INSET_PERCENT + 1e-9);
      }
    });

    it("the handle sits exactly on the fill edge everywhere it is not clamped by a rail", () => {
      let checked = 0;
      for (let i = 0; i <= 400; i++) {
        const shown = -i / 400;
        const frame = computePaintFrame(shown);
        if (frame.fillTopPercent < THUMB_INSET_PERCENT) continue;
        if (frame.fillTopPercent > 100 - THUMB_INSET_PERCENT) continue;
        checked++;
        expect(Math.abs(frame.thumbCenterPercent - frame.fillTopPercent)).toBeLessThan(1e-9);
      }
      expect(checked).toBeGreaterThan(0);
    });
  });

  describe("invariants", () => {
    it("fill top and height always account for the whole clip", () => {
      for (let i = 0; i <= 200; i++) {
        const frame = computePaintFrame(-i / 200);
        expect(frame.fillTopPercent + frame.fillHeightPercent).toBeCloseTo(100, 9);
        expect(frame.fillHeightPercent).toBeGreaterThanOrEqual(0);
      }
    });

    it("the fill only ever grows as the value moves back towards Original", () => {
      let previous = -1;
      for (let i = 0; i <= 200; i++) {
        const height = computePaintFrame(-1 + i / 200).fillHeightPercent;
        expect(height).toBeGreaterThanOrEqual(previous);
        previous = height;
      }
    });

    it("is a pure function with no shared state between calls", () => {
      expect(computePaintFrame(-0.4)).toEqual(computePaintFrame(-0.4));
    });
  });
});

describe("shared threshold constants stay distinct on purpose", () => {
  it("the drag dead zone and the Karaoke threshold are not the REST constant", () => {
    expect(DRAG_REST_SNAP).toBe(0.07);
    expect(KARAOKE_THRESHOLD).toBe(0.97);
  });
});
