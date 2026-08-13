import faderCss from "data-text:../ui/fader.css";
import { type RequestQueueTracksMessage, isQueueTracksMessage, isTrackArtworkMessage } from "@/capture/bridge-protocol";
import type { SourceId } from "@/acquisition/sources";
import { describeBusy } from "@/orchestrator/busy-tooltip";
import { describeDelivery } from "@/orchestrator/delivery";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { describeSeparation } from "@/orchestrator/separation-status";
import { trackStatusStore } from "@/orchestrator/track-status-store";
import { NEUTRAL_MIX_LEVEL } from "@/pageworld/gain-law";
import type { SetLoggingMessage } from "@/pageworld/protocol";
import { SETTINGS_STORAGE_KEY, sanitizeSettings } from "@/settings/settings";
import type { FaderPlacement, Settings } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import { createLogger, setLoggingEnabled } from "@/shared/logger";
import { extensionVersion } from "@/shared/version";
import { createFaderControl } from "@/ui/fader";
import type { FaderControl } from "@/ui/fader";
import { attachFaderMount, hasBetterLyrics } from "@/ui/mount";
import { createTooltip } from "@/ui/tooltip";
import type { Tooltip } from "@/ui/tooltip";
import type { PlasmoCSConfig } from "plasmo";
import {
  type BetterLyricsPresenceMessage,
  type TrackStatusMessage,
  isGetTrackStatusCommand,
  isHasBetterLyricsCommand,
} from "../../workers/protocol2";

const logger = createLogger("orchestrator");

// -- Fader UI wiring -----------------------------------------------------------

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_end",
  all_frames: false,
};

logger.log(`build ${extensionVersion()}`);

// -- Stylesheet ----------------------------------------------------------
const STYLE_ELEMENT_ID = "blyrics-karaoke-style";

function injectStylesheet(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = faderCss;
  (document.head ?? document.documentElement).appendChild(style);
}

function markUnavailable(button: HTMLButtonElement, dim = false): void {
  button.setAttribute("aria-disabled", "true");
  button.style.opacity = dim ? "0.45" : "";
  button.style.filter = dim ? "grayscale(70%)" : "";
  button.style.cursor = "not-allowed";
}

function markAvailable(button: HTMLButtonElement): void {
  button.removeAttribute("aria-disabled");
  button.style.opacity = "";
  button.style.filter = "";
  button.style.cursor = "";
}

function renderKaraokeState(control: FaderControl, tooltip: Tooltip, state: KaraokeState, armed: boolean): void {
  const button = control.button;
  control.setBusy(state.status === "waiting-for-capture" || state.status === "processing");
  switch (state.status) {
    case "waiting-for-capture":
    case "processing":
      markAvailable(button);
      tooltip.setContent(describeBusy(state, armed));
      break;
    case "ready-to-engage":
    case "engaged":
      markAvailable(button);
      tooltip.setContent({ label: "Click to remove vocals, hold to set the level", percent: null });
      break;
    case "failed":
      markUnavailable(button, true);
      tooltip.setContent({ label: `Sing-along unavailable: ${state.reason ?? "unknown error"}`, percent: null });
      break;
  }
}

// -- Master switch ---------------------------------------------------------

let latest: KaraokeState | null = null;

interface MountedFader {
  destroy(): void;
  setPlacement(next: FaderPlacement): void;
  setCrossfadeSeconds(seconds: number): void;
  deliveredSource(videoId: string): SourceId | null;
}

function mountFader(placement: FaderPlacement, crossfadeSeconds: number): MountedFader {
  injectStylesheet();

  let pipeline: ReturnType<typeof createKaraokePipeline> | undefined;
  let tooltip: Tooltip | undefined;
  let armed = false;

  function render(): void {
    if (latest && tooltip) renderKaraokeState(control, tooltip, latest, armed);
  }

  const control = createFaderControl({
    host: placement === "dock" && hasBetterLyrics() ? "dock" : "bar",
    onChange: (mixLevel, glideSeconds) => {
      armed = mixLevel !== NEUTRAL_MIX_LEVEL;
      pipeline?.engage(mixLevel, glideSeconds);
      render();
    },
    onOpenChange: open => tooltip?.setSuppressed(open),
  });

  tooltip = createTooltip(control.button);

  pipeline = createKaraokePipeline({
    onStateChange: state => {
      latest = state;
      render();
    },
    onCrossfadeStarted: durationSeconds => control.showCrossfade(durationSeconds),
  });

  const mount = attachFaderMount(
    { button: control.button, setHost: control.setHost, reanchorWipe: control.reanchorWipe },
    { placement }
  );
  pipeline.setCrossfadeSeconds(crossfadeSeconds);

  return {
    setPlacement: mount.setPlacement,
    setCrossfadeSeconds: seconds => pipeline?.setCrossfadeSeconds(seconds),
    deliveredSource: videoId => pipeline?.deliveredSource(videoId) ?? null,
    destroy() {
      mount.disconnect();
      pipeline?.destroy();
      tooltip.destroy();
      control.destroy();
      latest = null;
    },
  };
}

let mounted: MountedFader | null = null;

function applyLogging(enabled: boolean): void {
  setLoggingEnabled(enabled);
  const message: SetLoggingMessage = { type: "blk-set-logging", enabled };
  window.postMessage(message, window.location.origin);
}

function applySettings(settings: Settings): void {
  applyLogging(settings.debugLoggingEnabled);
  const { singAlongEnabled, faderPlacement, crossfadeSeconds } = settings;
  if (singAlongEnabled === (mounted !== null)) {
    mounted?.setPlacement(faderPlacement);
    mounted?.setCrossfadeSeconds(crossfadeSeconds);
    return;
  }
  if (singAlongEnabled) {
    mounted = mountFader(faderPlacement, crossfadeSeconds);
    logger.log("sing-along on");
    return;
  }
  mounted?.destroy();
  mounted = null;
  logger.log("sing-along off");
}

loadSettingsFrom(chrome.storage.sync)
  .then(applySettings)
  .catch(error => {
    logger.error("failed to check the sing-along setting", error);
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(SETTINGS_STORAGE_KEY in changes)) return;
  applySettings(sanitizeSettings(changes[SETTINGS_STORAGE_KEY].newValue));
});

// -- Track status ------------------------------------------------------------

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;
  if (isQueueTracksMessage(data)) {
    trackStatusStore.setTracks({ now: data.now, next: data.next });
    return;
  }
  if (isTrackArtworkMessage(data)) trackStatusStore.setArtwork(data.videoId, data.artworkUrl);
});

function requestQueueTracks(): void {
  const request: RequestQueueTracksMessage = { type: "blk-request-queue-tracks" };
  window.postMessage(request, window.location.origin);
}

// -- Better Lyrics probe, answered whether or not the fader is mounted ---------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isHasBetterLyricsCommand(message)) {
    const reply: BetterLyricsPresenceMessage = { type: "blk-better-lyrics-presence", present: hasBetterLyrics() };
    sendResponse(reply);
    return undefined;
  }

  if (isGetTrackStatusCommand(message)) {
    const tracks = trackStatusStore.get();
    const nowVideoId = tracks.now?.videoId ?? null;
    sendResponse({
      type: "blk-track-status",
      now: tracks.now,
      next: tracks.next,
      separation: describeSeparation(latest),
      deliveredBy: describeDelivery(nowVideoId ? mounted?.deliveredSource(nowVideoId) ?? null : null),
    } satisfies TrackStatusMessage);
    requestQueueTracks();
    return undefined;
  }

  return undefined;
});
