import faderCss from "data-text:../ui/fader.css";
import { type RequestQueueTracksMessage, isQueueTracksMessage, isTrackArtworkMessage } from "@/capture/bridge-protocol";
import { describeBusy } from "@/orchestrator/busy-tooltip";
import { describeDelivery } from "@/orchestrator/delivery";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { describeSeparation } from "@/orchestrator/separation-status";
import { trackStatusStore } from "@/orchestrator/track-status-store";
import { MIX_GLIDE_SECONDS, NEUTRAL_MIX_LEVEL, faderArmed } from "@/pageworld/gain-law";
import type { SetCrossfadeMessage, SetLoggingMessage } from "@/pageworld/protocol";
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
let faderRender: (() => void) | null = null;
let faderCrossfade: ((durationSeconds: number) => void) | null = null;

interface MountedFader {
  destroy(): void;
  setPlacement(next: FaderPlacement): void;
}

function mountFader(pipeline: KaraokePipeline, placement: FaderPlacement): MountedFader {
  injectStylesheet();

  let armed = false;
  let tooltip: Tooltip | undefined;

  function render(): void {
    if (latest && tooltip) renderKaraokeState(control, tooltip, latest, armed);
  }

  const control = createFaderControl({
    host: placement === "dock" && hasBetterLyrics() ? "dock" : "bar",
    onChange: (mixLevel, glideSeconds) => {
      armed = faderArmed(mixLevel);
      pipeline.engage(mixLevel, glideSeconds);
      render();
    },
    onOpenChange: open => tooltip?.setSuppressed(open),
  });

  tooltip = createTooltip(control.button);

  const mount = attachFaderMount(
    { button: control.button, setHost: control.setHost, reanchorWipe: control.reanchorWipe },
    { placement }
  );

  faderRender = render;
  faderCrossfade = control.showCrossfade;
  render();

  return {
    setPlacement: mount.setPlacement,
    destroy() {
      faderRender = null;
      faderCrossfade = null;
      mount.disconnect();
      tooltip?.destroy();
      control.destroy();
    },
  };
}

let pipeline: KaraokePipeline | null = null;
let fader: MountedFader | null = null;

function applyLogging(enabled: boolean): void {
  setLoggingEnabled(enabled);
  const message: SetLoggingMessage = { type: "blk-set-logging", enabled };
  window.postMessage(message, window.location.origin);
}

function postCrossfadeSeconds(seconds: number): void {
  const message: SetCrossfadeMessage = { type: "blk-set-crossfade", seconds };
  window.postMessage(message, window.location.origin);
}

function applySettings(settings: Settings): void {
  applyLogging(settings.debugLoggingEnabled);
  postCrossfadeSeconds(settings.crossfadeSeconds);

  const wantPipeline = settings.singAlongEnabled || settings.crossfadeSeconds > 0;
  if (wantPipeline && pipeline === null) {
    pipeline = createKaraokePipeline({
      settings,
      onStateChange: state => {
        latest = state;
        faderRender?.();
      },
      onCrossfadeStarted: durationSeconds => faderCrossfade?.(durationSeconds),
    });
    logger.log("pipeline on");
  } else if (!wantPipeline && pipeline !== null) {
    pipeline.destroy();
    pipeline = null;
    latest = null;
    logger.log("pipeline off");
  }

  pipeline?.setSettings(settings);

  if (settings.singAlongEnabled && fader === null && pipeline !== null) {
    fader = mountFader(pipeline, settings.faderPlacement);
    logger.log("sing-along on");
    return;
  }
  if (!settings.singAlongEnabled && fader !== null) {
    pipeline?.engage(NEUTRAL_MIX_LEVEL, MIX_GLIDE_SECONDS);
    fader.destroy();
    fader = null;
    logger.log("sing-along off");
    return;
  }
  fader?.setPlacement(settings.faderPlacement);
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
      deliveredBy: describeDelivery(nowVideoId ? pipeline?.deliveredSource(nowVideoId) ?? null : null),
    } satisfies TrackStatusMessage);
    requestQueueTracks();
    return undefined;
  }

  return undefined;
});
