import { MINIMUM_FADE_SECONDS } from "@/automix/transition-cue";
import { DEFAULT_BUDGET_BYTES } from "@/cache/stem-store";
import {
  CACHE_BUDGET_PRESETS_BYTES,
  CROSSFADE_PRESETS_SECONDS,
  DEFAULT_SETTINGS,
  MAX_CACHE_BUDGET_BYTES,
  MAX_CROSSFADE_SECONDS,
  MIN_CACHE_BUDGET_BYTES,
  isValidCacheBudgetBytes,
  isValidCrossfadeSeconds,
  sanitizeSettings,
  shouldEvictForNewBudget,
} from "@/settings/settings";
import { describe, expect, it } from "vitest";

// -- defaults -----------------------------------------------------------------

describe("DEFAULT_SETTINGS", () => {
  it("sing-along starts enabled", () => {
    expect(DEFAULT_SETTINGS.singAlongEnabled).toBe(true);
  });

  it("auto separate starts enabled", () => {
    expect(DEFAULT_SETTINGS.autoSeparateEnabled).toBe(true);
  });

  it("the cache budget default matches the stem store's own default", () => {
    expect(DEFAULT_SETTINGS.cacheBudgetBytes).toBe(DEFAULT_BUDGET_BYTES);
    expect(DEFAULT_SETTINGS.cacheBudgetBytes).toBe(250 * 1024 * 1024);
  });

  it("the fader starts in the dock, which falls back to the bar on its own", () => {
    expect(DEFAULT_SETTINGS.faderPlacement).toBe("dock");
  });
});

describe("CACHE_BUDGET_PRESETS_BYTES", () => {
  it("every preset is within the valid bounds", () => {
    for (const preset of CACHE_BUDGET_PRESETS_BYTES) {
      expect(isValidCacheBudgetBytes(preset)).toBe(true);
    }
  });

  it("includes the default budget", () => {
    expect(CACHE_BUDGET_PRESETS_BYTES).toContain(DEFAULT_SETTINGS.cacheBudgetBytes);
  });

  it("is sorted ascending", () => {
    const sorted = [...CACHE_BUDGET_PRESETS_BYTES].sort((a, b) => a - b);
    expect(CACHE_BUDGET_PRESETS_BYTES).toEqual(sorted);
  });
});

// -- isValidCacheBudgetBytes -----------------------------------------------------------------

describe("isValidCacheBudgetBytes", () => {
  it("accepts the minimum bound", () => {
    expect(isValidCacheBudgetBytes(MIN_CACHE_BUDGET_BYTES)).toBe(true);
  });

  it("accepts the maximum bound", () => {
    expect(isValidCacheBudgetBytes(MAX_CACHE_BUDGET_BYTES)).toBe(true);
  });

  it("rejects a negative budget", () => {
    expect(isValidCacheBudgetBytes(-1)).toBe(false);
  });

  it("rejects zero", () => {
    expect(isValidCacheBudgetBytes(0)).toBe(false);
  });

  it("rejects one byte below the minimum", () => {
    expect(isValidCacheBudgetBytes(MIN_CACHE_BUDGET_BYTES - 1)).toBe(false);
  });

  it("rejects one byte above the maximum", () => {
    expect(isValidCacheBudgetBytes(MAX_CACHE_BUDGET_BYTES + 1)).toBe(false);
  });

  it("rejects an absurdly large budget", () => {
    expect(isValidCacheBudgetBytes(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("rejects a non-integer byte count", () => {
    expect(isValidCacheBudgetBytes(MIN_CACHE_BUDGET_BYTES + 0.5)).toBe(false);
  });

  it("rejects NaN", () => {
    expect(isValidCacheBudgetBytes(Number.NaN)).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(isValidCacheBudgetBytes(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("rejects a numeric string", () => {
    expect(isValidCacheBudgetBytes(`${DEFAULT_SETTINGS.cacheBudgetBytes}`)).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isValidCacheBudgetBytes(null)).toBe(false);
    expect(isValidCacheBudgetBytes(undefined)).toBe(false);
  });
});

// -- sanitizeSettings -----------------------------------------------------------------

describe("sanitizeSettings", () => {
  it("returns the defaults for undefined input", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns the defaults for null input", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns the defaults for a primitive input", () => {
    expect(sanitizeSettings("not an object")).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("passes through a fully valid object unchanged", () => {
    const valid = {
      singAlongEnabled: true,
      autoSeparateEnabled: false,
      cacheBudgetBytes: 500 * 1024 * 1024,
      modelVariant: "fp16" as const,
      faderPlacement: "bar" as const,
      crossfadeSeconds: 6,
      debugLoggingEnabled: false,
    };
    expect(sanitizeSettings(valid)).toEqual(valid);
  });

  it("fills in a missing field with its default", () => {
    const partial = { singAlongEnabled: true };
    expect(sanitizeSettings(partial)).toEqual({ ...DEFAULT_SETTINGS, singAlongEnabled: true });
  });

  it("keeps a known model variant", () => {
    expect(sanitizeSettings({ modelVariant: "fp16" }).modelVariant).toBe("fp16");
    expect(sanitizeSettings({ modelVariant: "fp32" }).modelVariant).toBe("fp32");
  });

  it("falls back to full precision for an unknown model variant", () => {
    for (const value of ["fp8", "", null, 16, {}]) {
      expect(sanitizeSettings({ modelVariant: value }).modelVariant).toBe(DEFAULT_SETTINGS.modelVariant);
    }
  });

  it("keeps a known fader placement", () => {
    expect(sanitizeSettings({ faderPlacement: "dock" }).faderPlacement).toBe("dock");
    expect(sanitizeSettings({ faderPlacement: "bar" }).faderPlacement).toBe("bar");
  });

  it("falls back to the dock for an unknown fader placement", () => {
    for (const value of ["player-bar", "", null, 0, {}]) {
      expect(sanitizeSettings({ faderPlacement: value }).faderPlacement).toBe(DEFAULT_SETTINGS.faderPlacement);
    }
  });

  it("falls back to the default for a wrong-typed boolean field", () => {
    const corrupt = { singAlongEnabled: "yes", autoSeparateEnabled: 1 };
    expect(sanitizeSettings(corrupt)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to the default budget for a negative stored value", () => {
    expect(sanitizeSettings({ cacheBudgetBytes: -100 })).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to the default budget for an absurd stored value", () => {
    expect(sanitizeSettings({ cacheBudgetBytes: Number.MAX_SAFE_INTEGER })).toEqual(DEFAULT_SETTINGS);
  });

  it("drops unknown extra fields", () => {
    const withExtra = { ...DEFAULT_SETTINGS, somethingElse: "unexpected" };
    expect(sanitizeSettings(withExtra)).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores an array input", () => {
    expect(sanitizeSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
  });

  describe("crossfade length", () => {
    it("keeps a length inside the range, including the zero that means off", () => {
      for (const seconds of [0, 0.5, 4, 8, MAX_CROSSFADE_SECONDS]) {
        expect(sanitizeSettings({ crossfadeSeconds: seconds }).crossfadeSeconds).toBe(seconds);
      }
    });

    it("falls back to the default for anything out of range or the wrong type", () => {
      for (const value of [-1, MAX_CROSSFADE_SECONDS + 0.1, Number.NaN, Number.POSITIVE_INFINITY, "8", null, {}]) {
        expect(sanitizeSettings({ crossfadeSeconds: value }).crossfadeSeconds).toBe(DEFAULT_SETTINGS.crossfadeSeconds);
      }
    });
  });
});

// -- isValidCrossfadeSeconds --------------------------------------------------

describe("isValidCrossfadeSeconds", () => {
  it("accepts every preset the popup can offer", () => {
    for (const seconds of CROSSFADE_PRESETS_SECONDS) expect(isValidCrossfadeSeconds(seconds)).toBe(true);
  });

  it("accepts the bounds themselves", () => {
    expect(isValidCrossfadeSeconds(0)).toBe(true);
    expect(isValidCrossfadeSeconds(MAX_CROSSFADE_SECONDS)).toBe(true);
  });

  it("rejects anything that could reach setValueCurveAtTime and throw", () => {
    for (const value of [-0.001, MAX_CROSSFADE_SECONDS + 0.001, Number.NaN, Number.POSITIVE_INFINITY, "8", null]) {
      expect(isValidCrossfadeSeconds(value)).toBe(false);
    }
  });

  it("offers off as the first preset, so it is reachable without a keyboard", () => {
    expect(CROSSFADE_PRESETS_SECONDS[0]).toBe(0);
  });

  it("keeps every preset inside the bound the page world enforces", () => {
    for (const seconds of CROSSFADE_PRESETS_SECONDS) {
      expect(seconds).toBeLessThanOrEqual(MAX_CROSSFADE_SECONDS);
    }
  });

  it("steps one second at a time from the shortest usable fade to the longest", () => {
    expect([...CROSSFADE_PRESETS_SECONDS]).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  describe("invariants", () => {
    it("never offers a length the transition would refuse to run", () => {
      for (const seconds of CROSSFADE_PRESETS_SECONDS) {
        if (seconds === 0) continue;
        expect(seconds).toBeGreaterThanOrEqual(MINIMUM_FADE_SECONDS);
      }
    });

    it("ascends, so a slider index maps to a longer fade every step", () => {
      const ascending = [...CROSSFADE_PRESETS_SECONDS].sort((a, b) => a - b);
      expect([...CROSSFADE_PRESETS_SECONDS]).toEqual(ascending);
      expect(new Set(CROSSFADE_PRESETS_SECONDS).size).toBe(CROSSFADE_PRESETS_SECONDS.length);
    });
  });
});

// -- shouldEvictForNewBudget -----------------------------------------------------------------

describe("shouldEvictForNewBudget", () => {
  it("evicts when usage exceeds the new budget", () => {
    expect(shouldEvictForNewBudget(300 * 1024 * 1024, 250 * 1024 * 1024)).toBe(true);
  });

  it("does not evict when usage is within the new budget", () => {
    expect(shouldEvictForNewBudget(100 * 1024 * 1024, 250 * 1024 * 1024)).toBe(false);
  });

  it("does not evict when usage exactly equals the new budget", () => {
    expect(shouldEvictForNewBudget(250 * 1024 * 1024, 250 * 1024 * 1024)).toBe(false);
  });

  it("does not evict when a smaller budget still covers current usage", () => {
    expect(shouldEvictForNewBudget(200 * 1024 * 1024, 300 * 1024 * 1024)).toBe(false);
  });

  it("evicts when usage is nonzero and the new budget is zero", () => {
    expect(shouldEvictForNewBudget(1, 0)).toBe(true);
  });

  it("does not evict when usage is zero", () => {
    expect(shouldEvictForNewBudget(0, 0)).toBe(false);
  });
});
