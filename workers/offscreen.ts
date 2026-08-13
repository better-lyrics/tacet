import { acquireFromMintedUrl } from "../src/acquisition/acquire.js";
import { SEPARATION_VERSION, clearAllAliases } from "../src/cache/keys.js";
import { clearCachedModel, getCachedModelSize } from "../src/cache/model-cache.js";
import { getModelSha256, getModelUrl } from "../src/cache/model-url.js";
import { clearAllStemRecords, evictUntilWithinBudget, getTotalStemBytes } from "../src/cache/stem-store.js";
import { DEFAULT_SETTINGS, shouldEvictForNewBudget } from "../src/settings/settings.js";
import type { Settings } from "../src/settings/settings.js";
import {
  type CacheStatusMessage,
  type ClearCacheResultMessage,
  type GetSettingsCommand,
  type ModelChoice,
  isAcquireTrackCommand,
  isCancelSeparationCommand,
  isCaptureChunkMessage,
  isClearModelCacheCommand,
  isClearStemCacheCommand,
  isForgetTrackCommand,
  isGetCacheStatusCommand,
  isProbeCacheCommand,
  isRelayedThroughBackground,
  isSettingsChangedMessage,
  isSettingsMessage,
} from "./protocol2.js";
import { SeparationHost } from "./separation-host.js";
import { TrackPipeline } from "./track-pipeline.js";
import { createLogger, setLoggingEnabled } from "../src/shared/logger.js";

const logger = createLogger("offscreen");

// -- Separation version purge -------------------------------------------------

const SEPARATION_VERSION_KEY = "blk-separation-version";

function purgeStaleSeparations(): void {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(SEPARATION_VERSION_KEY);
  } catch (error) {
    logger.warn("could not read the separation version", error);
    return;
  }
  if (previous === SEPARATION_VERSION) return;

  localStorage.setItem(SEPARATION_VERSION_KEY, SEPARATION_VERSION);
  Promise.all([clearAllStemRecords(), clearAllAliases()])
    .then(() => logger.log(`cleared stems from a previous separation version (${previous ?? "none"})`))
    .catch(error => {
      logger.error("failed to purge stale separations", error);
    });
}

purgeStaleSeparations();

// -- Settings-driven cache budget and model choice -----------------------------

const SETTINGS_RETRY_DELAYS_MS = [250, 1000, 4000];

let currentCacheBudgetBytes = DEFAULT_SETTINGS.cacheBudgetBytes;
let currentModelChoice: ModelChoice = {
  modelUrl: getModelUrl(DEFAULT_SETTINGS.modelVariant),
  modelSha256: getModelSha256(DEFAULT_SETTINGS.modelVariant),
};
let modelChoiceReceived = false;

function applySettings(settings: Settings, model: ModelChoice): void {
  setLoggingEnabled(settings.debugLoggingEnabled);
  currentCacheBudgetBytes = settings.cacheBudgetBytes;
  currentModelChoice = model;
  modelChoiceReceived = true;
}

async function reactToBudgetChange(newBudgetBytes: number): Promise<void> {
  const usedBytes = await getTotalStemBytes();
  if (shouldEvictForNewBudget(usedBytes, newBudgetBytes)) {
    await evictUntilWithinBudget(newBudgetBytes);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadSettingsOverRelay(): Promise<void> {
  const getSettingsCommand: GetSettingsCommand = { type: "blk-get-settings" };
  for (let attempt = 0; ; attempt++) {
    try {
      const response: unknown = await chrome.runtime.sendMessage(getSettingsCommand);
      if (isSettingsMessage(response)) {
        applySettings(response.settings, response.model);
        return;
      }
      logger.warn(`settings request ${attempt + 1} came back as ${JSON.stringify(response)}`);
    } catch (error) {
      logger.warn(`settings request ${attempt + 1} failed`, error);
    }
    if (attempt >= SETTINGS_RETRY_DELAYS_MS.length) {
      logger.error("giving up on the settings relay, staying on the defaults");
      return;
    }
    await delay(SETTINGS_RETRY_DELAYS_MS[attempt]);
  }
}

loadSettingsOverRelay().catch(error => {
  logger.error("failed to load settings", error);
});

function getCacheBudgetBytes(): number {
  return currentCacheBudgetBytes;
}

function getModelChoice(): ModelChoice {
  if (!modelChoiceReceived) {
    logger.error(`no model choice has arrived, falling back to ${currentModelChoice.modelUrl}`);
  }
  return currentModelChoice;
}

// -- Real separation host -----------------------------------------------

const separationHost = new SeparationHost();
const trackPipeline = new TrackPipeline(separationHost, getCacheBudgetBytes, getModelChoice);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab !== undefined && isRelayedThroughBackground(message)) return undefined;

  if (isCaptureChunkMessage(message)) {
    trackPipeline.handleCaptureChunk(message);
    return;
  }

  if (isAcquireTrackCommand(message)) {
    trackPipeline.acquireTrack(message.videoId, message.url).catch(error => {
      logger.error("acquiring a track threw", error);
    });
    return;
  }

  if (isCancelSeparationCommand(message)) {
    trackPipeline.cancelActive();
    return;
  }

  if (isSettingsChangedMessage(message)) {
    applySettings(message.settings, message.model);
    reactToBudgetChange(message.settings.cacheBudgetBytes).catch(error => {
      logger.error("failed to react to a settings change", error);
    });
  }
});

// -- Cache status and clearing (popup) ---------------------------------------

async function fetchCacheStatus(): Promise<CacheStatusMessage> {
  const stemCacheBytes = await getTotalStemBytes();
  const modelCacheBytes = await getCachedModelSize(getModelChoice().modelUrl);
  return {
    type: "blk-cache-status",
    stemCacheBytes,
    modelCached: modelCacheBytes !== null,
    modelCacheBytes: modelCacheBytes ?? 0,
  };
}

async function clearStemCache(): Promise<ClearCacheResultMessage> {
  trackPipeline.cancelActive();
  await clearAllStemRecords();
  await clearAllAliases();
  return { type: "blk-clear-cache-result", target: "stems", ok: true };
}

async function clearModelCache(): Promise<ClearCacheResultMessage> {
  trackPipeline.cancelActive();
  await clearCachedModel(getModelChoice().modelUrl);
  return { type: "blk-clear-cache-result", target: "model", ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isGetCacheStatusCommand(message)) {
    fetchCacheStatus()
      .then(sendResponse)
      .catch(error => {
        logger.error("failed to read cache status", error);
      });
    return true;
  }

  if (isClearStemCacheCommand(message)) {
    clearStemCache()
      .then(sendResponse)
      .catch(error => {
        logger.error("failed to clear the stem cache", error);
      });
    return true;
  }

  if (isClearModelCacheCommand(message)) {
    clearModelCache()
      .then(sendResponse)
      .catch(error => {
        logger.error("failed to clear the model cache", error);
      });
    return true;
  }

  return undefined;
});

// -- Stem verification hook -----------------------------------------------

interface StemAnalysis {
  key: string;
  vocalsBytes: number;
  instrumentalBytes: number;
  frames: number;
  sampleRate: number;
  vocalsRms: number;
  instrumentalRms: number;
  correlation: number;
  verdict: string;
}

function rms(channel: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / Math.max(1, channel.length));
}

function correlate(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const denom = Math.sqrt(aa * bb);
  return denom === 0 ? 0 : dot / denom;
}

async function analyseCachedStems(): Promise<StemAnalysis[]> {
  const { decodeOpusToPcm } = await import("../src/cache/opus-codec.js");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("blk-cache");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const entries = await new Promise<Array<{ key: IDBValidKey; value: Record<string, unknown> }>>((resolve, reject) => {
    const tx = db.transaction("stems", "readonly");
    const store = tx.objectStore("stems");
    const collected: Array<{ key: IDBValidKey; value: Record<string, unknown> }> = [];
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(collected);
        return;
      }
      collected.push({ key: cursor.key, value: cursor.value as Record<string, unknown> });
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
  db.close();

  const results: StemAnalysis[] = [];
  for (const entry of entries) {
    const vocalsBlob = entry.value.vocals as Blob;
    const instrumentalBlob = entry.value.instrumental as Blob;
    const vocals = await decodeOpusToPcm(vocalsBlob);
    const instrumental = await decodeOpusToPcm(instrumentalBlob);
    const vocalsRms = rms(vocals.channels[0]);
    const instrumentalRms = rms(instrumental.channels[0]);
    const correlation = correlate(vocals.channels[0], instrumental.channels[0]);
    results.push({
      key: String(entry.key),
      vocalsBytes: vocalsBlob.size,
      instrumentalBytes: instrumentalBlob.size,
      frames: vocals.channels[0].length,
      sampleRate: vocals.sampleRate,
      vocalsRms,
      instrumentalRms,
      correlation,
      verdict:
        vocalsRms < 1e-4
          ? "FAILED: vocals stem is silent"
          : Math.abs(correlation) > 0.8
            ? "FAILED: stems are near-identical, separation did not happen"
            : "OK: stems are distinct signals",
    });
  }
  return results;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab !== undefined && isRelayedThroughBackground(message)) return undefined;

  if (isForgetTrackCommand(message)) {
    trackPipeline.forgetTrack(message.videoId).catch(error => {
      logger.error("could not forget a track", error);
    });
    return undefined;
  }
  if (!isProbeCacheCommand(message)) return undefined;
  trackPipeline.probeCache(message.videoId).catch(error => {
    logger.error("cache probe failed", error);
  });
  return undefined;
});

(self as unknown as Record<string, unknown>).blkAnalyseCachedStems = analyseCachedStems;

// -- Synthetic pipeline bisect --------------------------------------------

async function runSelfTest(forceWasm = false): Promise<unknown> {
  const { runPipelineSelfTest } = await import("./pipeline-selftest.js");
  return runPipelineSelfTest(separationHost, getModelChoice(), forceWasm);
}

(self as unknown as Record<string, unknown>).blkRunPipelineSelfTest = runSelfTest;

// -- Pulling a track from a url a player minted ----------------------------------

async function acquireMinted(url: string, windowBytes?: number): Promise<unknown> {
  const started = Date.now();
  const trace: unknown[] = [];
  const acquired = await acquireFromMintedUrl({
    url,
    windowBytes,
    onResponse: response => trace.push(response),
  });
  const digest = acquired.bytes.length
    ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", acquired.bytes))]
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("")
    : null;
  return {
    ok: acquired.ok,
    reason: acquired.reason,
    itag: acquired.itag,
    mimeType: acquired.mimeType,
    receivedBytes: acquired.bytes.length,
    expectedBytes: acquired.expectedBytes,
    requests: acquired.requests,
    protectionStatus: acquired.protectionStatus,
    elapsedMs: Date.now() - started,
    sha256: digest,
    trace,
  };
}

(self as unknown as Record<string, unknown>).blkAcquireFromMintedUrl = acquireMinted;
