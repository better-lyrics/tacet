import { SOURCE_IDS, sanitizeSourcePreferences } from "@/acquisition/sources";
import type { SourcePreference } from "@/acquisition/sources";
import { DEFAULT_MODEL_VARIANT, type ModelVariant, isModelVariant } from "@/cache/model-url";
import { DEFAULT_BUDGET_BYTES } from "@/cache/stem-store";
import { type SeparationMode, isSeparationMode, separationModeFromLegacy } from "@/settings/separation-mode";

// -- Storage key --------------------------------------------------------------

const SETTINGS_STORAGE_KEY = "blk-settings";

// -- Cache budget bounds and presets -------------------------------------------

const MIN_CACHE_BUDGET_BYTES = 50 * 1024 * 1024;
const MAX_CACHE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

const CACHE_BUDGET_PRESETS_BYTES: readonly number[] = [100, 250, 500, 1000, 2000].map(
  megabytes => megabytes * 1024 * 1024
);

// -- Fader placement -------------------------------------------------------------

type FaderPlacement = "dock" | "bar";

const FADER_PLACEMENTS: readonly FaderPlacement[] = ["dock", "bar"];

function isFaderPlacement(value: unknown): value is FaderPlacement {
  return typeof value === "string" && FADER_PLACEMENTS.includes(value as FaderPlacement);
}

// -- Crossfade length ------------------------------------------------------------

const CROSSFADE_PRESETS_SECONDS: readonly number[] = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_CROSSFADE_SECONDS = 20;

function isValidCrossfadeSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_CROSSFADE_SECONDS;
}

// -- Settings shape -------------------------------------------------------------

interface Settings {
  separationMode: SeparationMode;
  cacheBudgetBytes: number;
  modelVariant: ModelVariant;
  faderPlacement: FaderPlacement;
  crossfadeSeconds: number;
  sources: SourcePreference[];
  debugLoggingEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  separationMode: "on-demand",
  cacheBudgetBytes: DEFAULT_BUDGET_BYTES,
  modelVariant: DEFAULT_MODEL_VARIANT,
  faderPlacement: "dock",
  crossfadeSeconds: 8,
  sources: SOURCE_IDS.map(id => ({ id, enabled: true })),
  debugLoggingEnabled: false,
};

// -- Validation -----------------------------------------------------------------

function isValidCacheBudgetBytes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_CACHE_BUDGET_BYTES &&
    value <= MAX_CACHE_BUDGET_BYTES
  );
}

function legacyBooleanOrOn(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

function resolveSeparationMode(record: Record<string, unknown>): SeparationMode {
  if (isSeparationMode(record.separationMode)) return record.separationMode;
  const hasLegacy = typeof record.singAlongEnabled === "boolean" || typeof record.autoSeparateEnabled === "boolean";
  if (!hasLegacy) return DEFAULT_SETTINGS.separationMode;
  return separationModeFromLegacy(
    legacyBooleanOrOn(record.singAlongEnabled),
    legacyBooleanOrOn(record.autoSeparateEnabled)
  );
}

function sanitizeSettings(raw: unknown): Settings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    separationMode: resolveSeparationMode(record),
    cacheBudgetBytes: isValidCacheBudgetBytes(record.cacheBudgetBytes)
      ? record.cacheBudgetBytes
      : DEFAULT_SETTINGS.cacheBudgetBytes,
    modelVariant: isModelVariant(record.modelVariant) ? record.modelVariant : DEFAULT_SETTINGS.modelVariant,
    faderPlacement: isFaderPlacement(record.faderPlacement) ? record.faderPlacement : DEFAULT_SETTINGS.faderPlacement,
    crossfadeSeconds: isValidCrossfadeSeconds(record.crossfadeSeconds)
      ? record.crossfadeSeconds
      : DEFAULT_SETTINGS.crossfadeSeconds,
    sources: sanitizeSourcePreferences(record.sources),
    debugLoggingEnabled:
      typeof record.debugLoggingEnabled === "boolean"
        ? record.debugLoggingEnabled
        : DEFAULT_SETTINGS.debugLoggingEnabled,
  };
}

// -- Eviction-on-budget-change decision ------------------------------------------

function shouldEvictForNewBudget(currentUsageBytes: number, newBudgetBytes: number): boolean {
  return currentUsageBytes > newBudgetBytes;
}

export {
  SETTINGS_STORAGE_KEY,
  MIN_CACHE_BUDGET_BYTES,
  MAX_CACHE_BUDGET_BYTES,
  CACHE_BUDGET_PRESETS_BYTES,
  CROSSFADE_PRESETS_SECONDS,
  MAX_CROSSFADE_SECONDS,
  FADER_PLACEMENTS,
  DEFAULT_SETTINGS,
  isFaderPlacement,
  isValidCacheBudgetBytes,
  isValidCrossfadeSeconds,
  sanitizeSettings,
  shouldEvictForNewBudget,
};
export type { Settings, FaderPlacement };
