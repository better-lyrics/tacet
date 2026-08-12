import { getModelSha256, getModelUrl } from "@/cache/model-url";
import { createTabRegistry } from "@/orchestrator/tab-registry";
import { SETTINGS_STORAGE_KEY, sanitizeSettings } from "@/settings/settings";
import type { Settings } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import { bytesToBase64 } from "@/relay/base64";
import {
  type ModelChoice,
  type SettingsChangedMessage,
  type SettingsMessage,
  type ObservedRequestsMessage,
  isAcquireTrackCommand,
  isCaptureChunkMessage,
  isObservedRequestsCommand,
  isProbeCacheCommand,
  isClearModelCacheCommand,
  isClearStemCacheCommand,
  isForgetTrackCommand,
  isGetCacheStatusCommand,
  isGetSettingsCommand,
  isTrackPipelineOutboundMessage,
} from "../workers/protocol2";
import { createLogger, setLoggingEnabled } from "@/shared/logger";

const logger = createLogger("pipeline");

// -- Offscreen document lifecycle -------------------------------------------

const OFFSCREEN_URL = "assets/offscreen.html";
const OFFSCREEN_JUSTIFICATION = "Separating vocals from the track the listener is playing.";
const ALREADY_EXISTS_MESSAGE = "single offscreen document";

async function ensureOffscreenDocument(): Promise<void> {
  const hasDocument = await chrome.offscreen.hasDocument();
  if (hasDocument) return;

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_URL),
      reasons: ["WORKERS", "AUDIO_PLAYBACK"],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(ALREADY_EXISTS_MESSAGE)) throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -- Model choice -----------------------------------------------------------

function modelChoiceFor(settings: Settings): ModelChoice {
  return { modelUrl: getModelUrl(settings.modelVariant), modelSha256: getModelSha256(settings.modelVariant) };
}

// -- Watching the player's own media requests ---------------------------------

const MEDIA_URL_PATTERN = "https://*.googlevideo.com/*";
const CONTROL_URL_PATTERN = "https://music.youtube.com/*";
const OBSERVED_REQUEST_LIMIT = 8;

interface ObservedRequest {
  at: number;
  url: string;
  method: string;
  bodyBytes: number;
  body: string;
}

const observedRequests: ObservedRequest[] = [];
const observedCounts: Record<string, number> = {};

const OBSERVED_STORAGE_KEY = "blk-observed-requests";

function rememberObserved(): void {
  chrome.storage.session
    ?.set({ [OBSERVED_STORAGE_KEY]: { counts: observedCounts, requests: observedRequests } })
    .catch(error => logger.error("could not stash what the player asked for", error));
}

async function recallObserved(): Promise<void> {
  const stored = await chrome.storage.session?.get(OBSERVED_STORAGE_KEY);
  const held = stored?.[OBSERVED_STORAGE_KEY] as { counts?: Record<string, number>; requests?: ObservedRequest[] };
  if (!held) return;
  Object.assign(observedCounts, held.counts ?? {});
  observedRequests.push(...(held.requests ?? []));
}

interface RawBodyCarrier {
  requestBody?: { raw?: { bytes?: ArrayBuffer }[] | undefined } | undefined;
}

function rawBodyOf(details: RawBodyCarrier): Uint8Array | null {
  const raw = details.requestBody?.raw;
  if (!raw || raw.length === 0) return null;
  const parts = raw.map(entry => (entry.bytes ? new Uint8Array(entry.bytes) : new Uint8Array()));
  const total = parts.reduce((sum: number, part: Uint8Array) => sum + part.length, 0);
  if (total === 0) return null;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

function observePlayerRequests(): void {
  if (!chrome.webRequest?.onBeforeRequest) {
    logger.error("this build cannot watch the player's own requests", new Error("no webRequest.onBeforeRequest"));
    return;
  }
  chrome.webRequest.onBeforeRequest.addListener(
    details => {
      const body = rawBodyOf(details);
      const host = new URL(details.url).hostname.endsWith("googlevideo.com") ? "googlevideo" : "ytm";
      const kind = `${host}-${details.method}${body ? "-with-body" : "-no-body"}`;
      observedCounts[kind] = (observedCounts[kind] ?? 0) + 1;
      if (body) {
        observedRequests.push({
          at: Date.now(),
          url: details.url,
          method: details.method,
          bodyBytes: body.length,
          body: bytesToBase64(body),
        });
        while (observedRequests.length > OBSERVED_REQUEST_LIMIT) observedRequests.shift();
      }
      rememberObserved();
      return undefined;
    },
    { urls: [MEDIA_URL_PATTERN, CONTROL_URL_PATTERN] },
    ["requestBody"]
  );
  logger.log("watching the player's own media requests");
}

observePlayerRequests();
recallObserved().catch(error => logger.error("could not recall what the player asked for", error));

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isObservedRequestsCommand(message)) return undefined;
  recallObserved()
    .catch(() => undefined)
    .finally(() => {
      const response: ObservedRequestsMessage = {
        type: "blk-observed-requests",
        counts: observedCounts,
        requests: observedRequests,
      };
      sendResponse(response);
    });
  return true;
});

// -- Track pipeline relay --------------------------------------------------

const tabRegistry = createTabRegistry();

function relayToTabForVideo(videoId: string, message: unknown): void {
  for (const tabId of tabRegistry.tabsFor(videoId)) {
    chrome.tabs.sendMessage(tabId, message).catch(() => tabRegistry.forgetTab(tabId));
  }
}

chrome.tabs.onRemoved.addListener(tabId => tabRegistry.forgetTab(tabId));

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (isProbeCacheCommand(message)) {
    const probeTabId = sender.tab?.id;
    if (probeTabId !== undefined) tabRegistry.remember(message.videoId, probeTabId);
    sendToOffscreenWithRetry(message).catch(error => {
      logger.error("failed to relay a cache probe", error);
    });
    return undefined;
  }

  if (isForgetTrackCommand(message)) {
    sendToOffscreenWithRetry(message).catch(error => {
      logger.error("failed to relay a forget-track command", error);
    });
    return undefined;
  }

  if (isAcquireTrackCommand(message)) {
    const acquireTabId = sender.tab?.id;
    if (acquireTabId !== undefined) tabRegistry.remember(message.videoId, acquireTabId);
    sendToOffscreenWithRetry(message).catch(error => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      relayToTabForVideo(message.videoId, {
        type: "blk-acquire-failed",
        videoId: message.videoId,
        reason: `Failed to reach the offscreen document: ${errorMessage}`,
      });
    });
    return undefined;
  }

  if (isCaptureChunkMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) tabRegistry.remember(message.videoId, tabId);

    sendToOffscreenWithRetry(message).catch(error => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      relayToTabForVideo(message.videoId, {
        type: "blk-track-error",
        videoId: message.videoId,
        code: "unknown",
        message: `Failed to reach the offscreen document: ${errorMessage}`,
      });
    });
    return;
  }

  if (isTrackPipelineOutboundMessage(message)) {
    relayToTabForVideo(message.videoId, message);
    if (message.type === "blk-track-done" || message.type === "blk-track-error") {
      tabRegistry.forgetVideo(message.videoId);
    }
  }
});

// -- Cache status and clearing relay (popup) ---------------------------------

async function sendToOffscreenWithRetry(message: unknown): Promise<unknown> {
  await ensureOffscreenDocument();
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    await delay(250);
    return chrome.runtime.sendMessage(message);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isGetCacheStatusCommand(message) && !isClearStemCacheCommand(message) && !isClearModelCacheCommand(message)) {
    return undefined;
  }

  sendToOffscreenWithRetry(message)
    .then(sendResponse)
    .catch(error => {
      logger.error("cache command failed", error);
    });
  return true;
});

// -- Settings relay (offscreen has no chrome.storage) --------------------------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isGetSettingsCommand(message)) return undefined;

  loadSettingsFrom(chrome.storage.sync)
    .then(settings => {
      const response: SettingsMessage = { type: "blk-settings", settings, model: modelChoiceFor(settings) };
      sendResponse(response);
    })
    .catch(error => {
      logger.error("failed to load settings", error);
    });
  return true;
});

loadSettingsFrom(chrome.storage.sync)
  .then(settings => setLoggingEnabled(settings.debugLoggingEnabled))
  .catch(error => logger.error("failed to read the logging setting", error));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(SETTINGS_STORAGE_KEY in changes)) return;
  setLoggingEnabled(sanitizeSettings(changes[SETTINGS_STORAGE_KEY].newValue).debugLoggingEnabled);

  chrome.offscreen
    .hasDocument()
    .then(async hasDocument => {
      if (!hasDocument) return;
      const settings = await loadSettingsFrom(chrome.storage.sync);
      const message: SettingsChangedMessage = {
        type: "blk-settings-changed",
        settings,
        model: modelChoiceFor(settings),
      };
      await chrome.runtime.sendMessage(message);
    })
    .catch(error => {
      logger.error("failed to broadcast a settings change", error);
    });
});
