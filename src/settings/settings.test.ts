import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_BYTES } from "@/cache/stem-store";
import {
  CACHE_BUDGET_PRESETS_BYTES,
  DEFAULT_SETTINGS,
  MAX_CACHE_BUDGET_BYTES,
  MIN_CACHE_BUDGET_BYTES,
  isValidCacheBudgetBytes,
  sanitizeSettings,
  shouldEvictForNewBudget,
} from "@/settings/settings";

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
