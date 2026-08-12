import { SOURCE_IDS, sanitizeSourceOrder } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";
import { DEFAULT_MODEL_VARIANT, type ModelVariant, isModelVariant } from "@/cache/model-url";
import { DEFAULT_BUDGET_BYTES } from "@/cache/stem-store";

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
  singAlongEnabled: boolean;
  autoSeparateEnabled: boolean;
  cacheBudgetBytes: number;
  modelVariant: ModelVariant;
  faderPlacement: FaderPlacement;
  crossfadeSeconds: number;
  sourceOrder: SourceId[];
  debugLoggingEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  singAlongEnabled: true,
  autoSeparateEnabled: true,
  cacheBudgetBytes: DEFAULT_BUDGET_BYTES,
  modelVariant: DEFAULT_MODEL_VARIANT,
  faderPlacement: "dock",
  crossfadeSeconds: 8,
  sourceOrder: [...SOURCE_IDS],
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

function sanitizeSettings(raw: unknown): Settings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    singAlongEnabled:
      typeof record.singAlongEnabled === "boolean" ? record.singAlongEnabled : DEFAULT_SETTINGS.singAlongEnabled,
    autoSeparateEnabled:
      typeof record.autoSeparateEnabled === "boolean"
        ? record.autoSeparateEnabled
        : DEFAULT_SETTINGS.autoSeparateEnabled,
    cacheBudgetBytes: isValidCacheBudgetBytes(record.cacheBudgetBytes)
      ? record.cacheBudgetBytes
      : DEFAULT_SETTINGS.cacheBudgetBytes,
    modelVariant: isModelVariant(record.modelVariant) ? record.modelVariant : DEFAULT_SETTINGS.modelVariant,
    faderPlacement: isFaderPlacement(record.faderPlacement) ? record.faderPlacement : DEFAULT_SETTINGS.faderPlacement,
    crossfadeSeconds: isValidCrossfadeSeconds(record.crossfadeSeconds)
      ? record.crossfadeSeconds
      : DEFAULT_SETTINGS.crossfadeSeconds,
    sourceOrder: sanitizeSourceOrder(record.sourceOrder),
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
