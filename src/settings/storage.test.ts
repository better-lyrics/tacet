import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MAX_CACHE_BUDGET_BYTES, SETTINGS_STORAGE_KEY } from "@/settings/settings";
import { loadSettingsFrom, saveSettingsFrom } from "@/settings/storage";
import type { SettingsStorageArea } from "@/settings/storage";

// -- Test helpers -----------------------------------------------------------------

function createFakeStorageArea(seed: Record<string, unknown> = {}): SettingsStorageArea {
  const store: Record<string, unknown> = { ...seed };
  return {
    async get(key) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items) {
      Object.assign(store, items);
    },
  };
}

// -- happy path -----------------------------------------------------------------

describe("loadSettingsFrom", () => {
  it("returns the defaults when storage is empty", async () => {
    const storage = createFakeStorageArea();
    expect(await loadSettingsFrom(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns a previously saved value", async () => {
    const storage = createFakeStorageArea({
      [SETTINGS_STORAGE_KEY]: {
        singAlongEnabled: true,
        autoSeparateEnabled: false,
        cacheBudgetBytes: 500 * 1024 * 1024,
        modelVariant: "fp16",
      },
    });
    expect(await loadSettingsFrom(storage)).toEqual({
      singAlongEnabled: true,
      autoSeparateEnabled: false,
      cacheBudgetBytes: 500 * 1024 * 1024,
      modelVariant: "fp16",
      faderPlacement: DEFAULT_SETTINGS.faderPlacement,
      crossfadeSeconds: DEFAULT_SETTINGS.crossfadeSeconds,
      sources: DEFAULT_SETTINGS.sources,
      debugLoggingEnabled: DEFAULT_SETTINGS.debugLoggingEnabled,
    });
  });

  it("sanitizes a corrupt stored value rather than throwing", async () => {
    const storage = createFakeStorageArea({ [SETTINGS_STORAGE_KEY]: { cacheBudgetBytes: -5 } });
    expect(await loadSettingsFrom(storage)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettingsFrom", () => {
  it("writes a full settings object round-trippable by loadSettingsFrom", async () => {
    const storage = createFakeStorageArea();
    const saved = await saveSettingsFrom(storage, { singAlongEnabled: true });
    expect(saved.singAlongEnabled).toBe(true);
    expect(await loadSettingsFrom(storage)).toEqual(saved);
  });

  it("merges a partial update with the existing settings rather than clobbering them", async () => {
    const storage = createFakeStorageArea();
    await saveSettingsFrom(storage, { singAlongEnabled: true, cacheBudgetBytes: 500 * 1024 * 1024 });
    const second = await saveSettingsFrom(storage, { autoSeparateEnabled: false });

    expect(second).toEqual({
      singAlongEnabled: true,
      autoSeparateEnabled: false,
      cacheBudgetBytes: 500 * 1024 * 1024,
      modelVariant: DEFAULT_SETTINGS.modelVariant,
      faderPlacement: DEFAULT_SETTINGS.faderPlacement,
      crossfadeSeconds: DEFAULT_SETTINGS.crossfadeSeconds,
      sources: DEFAULT_SETTINGS.sources,
      debugLoggingEnabled: DEFAULT_SETTINGS.debugLoggingEnabled,
    });
  });

  it("rejects an invalid partial value, falling back to the default for that field", async () => {
    const storage = createFakeStorageArea();
    const saved = await saveSettingsFrom(storage, { cacheBudgetBytes: -1 });
    expect(saved.cacheBudgetBytes).toBe(DEFAULT_SETTINGS.cacheBudgetBytes);
  });

  it("rejects an absurd partial budget update", async () => {
    const storage = createFakeStorageArea();
    const saved = await saveSettingsFrom(storage, { cacheBudgetBytes: MAX_CACHE_BUDGET_BYTES + 1 });
    expect(saved.cacheBudgetBytes).toBe(DEFAULT_SETTINGS.cacheBudgetBytes);
  });

  it("an empty partial update is a no-op beyond re-sanitizing", async () => {
    const storage = createFakeStorageArea();
    await saveSettingsFrom(storage, { singAlongEnabled: true });
    const second = await saveSettingsFrom(storage, {});
    expect(second.singAlongEnabled).toBe(true);
  });
});

// -- invariants -----------------------------------------------------------------

describe("invariants", () => {
  it("every saved settings object is valid input to a subsequent load", async () => {
    const storage = createFakeStorageArea();
    await saveSettingsFrom(storage, { cacheBudgetBytes: 1_000_000_000 });
    const loaded = await loadSettingsFrom(storage);
    expect(loaded).toEqual(await loadSettingsFrom(storage));
  });

  it("saving does not touch unrelated keys already in storage", async () => {
    const storage = createFakeStorageArea({ "unrelated-key": "leave me alone" });
    await saveSettingsFrom(storage, { singAlongEnabled: true });
    expect(await storage.get("unrelated-key")).toEqual({ "unrelated-key": "leave me alone" });
  });
});
