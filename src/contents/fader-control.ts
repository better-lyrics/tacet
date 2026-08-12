import faderCss from "data-text:../ui/fader.css";
import {
  type RequestComingUpMessage,
  isComingUpTrackMessage,
  isNextTrackArtworkMessage,
} from "@/capture/bridge-protocol";
import { describeBusy } from "@/orchestrator/busy-tooltip";
import { comingUpStore } from "@/orchestrator/coming-up-store";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { NEUTRAL_MIX_LEVEL } from "@/pageworld/gain-law";
import { SETTINGS_STORAGE_KEY, sanitizeSettings } from "@/settings/settings";
import type { FaderPlacement } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import { createLogger } from "@/shared/logger";
import { extensionVersion } from "@/shared/version";
import { createFaderControl } from "@/ui/fader";
import type { FaderControl } from "@/ui/fader";
import { attachFaderMount, hasBetterLyrics } from "@/ui/mount";
import { createTooltip } from "@/ui/tooltip";
import type { Tooltip } from "@/ui/tooltip";
import type { PlasmoCSConfig } from "plasmo";
import {
  type BetterLyricsPresenceMessage,
  type ComingUpMessage,
  isGetComingUpCommand,
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
  // The shimmer, not a grey-out, is the working state. Grey reads as broken.
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

function mountFader(placement: FaderPlacement): { destroy(): void; setPlacement(next: FaderPlacement): void } {
  injectStylesheet();

  let pipeline: ReturnType<typeof createKaraokePipeline> | undefined;
  let tooltip: Tooltip | undefined;
  let latest: KaraokeState | null = null;
  let armed = false;

  function render(): void {
    if (latest && tooltip) renderKaraokeState(control, tooltip, latest, armed);
  }

  const control = createFaderControl({
    host: placement === "dock" && hasBetterLyrics() ? "dock" : "bar",
    onChange: mixLevel => {
      armed = mixLevel !== NEUTRAL_MIX_LEVEL;
      pipeline?.engage(mixLevel);
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
  });

  const mount = attachFaderMount({ button: control.button, setHost: control.setHost }, { placement });

  return {
    setPlacement: mount.setPlacement,
    destroy() {
      mount.disconnect();
      // First, since it is what hands the audio back to the original.
      pipeline?.destroy();
      tooltip.destroy();
      control.destroy();
    },
  };
}

let mounted: { destroy(): void; setPlacement(next: FaderPlacement): void } | null = null;

function applySettings(enabled: boolean, placement: FaderPlacement): void {
  if (enabled === (mounted !== null)) {
    mounted?.setPlacement(placement);
    return;
  }
  if (enabled) {
    mounted = mountFader(placement);
    logger.log("sing-along on");
    return;
  }
  mounted?.destroy();
  mounted = null;
  logger.log("sing-along off");
}

loadSettingsFrom(chrome.storage.sync)
  .then(settings => applySettings(settings.singAlongEnabled, settings.faderPlacement))
  .catch(error => {
    logger.error("failed to check the sing-along setting", error);
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(SETTINGS_STORAGE_KEY in changes)) return;
  const settings = sanitizeSettings(changes[SETTINGS_STORAGE_KEY].newValue);
  applySettings(settings.singAlongEnabled, settings.faderPlacement);
});

// -- Coming up ---------------------------------------------------------------
//
// Fed by the page world, which is the only side that can read the queue's
// Polymer data. Requested on demand rather than pushed, so nothing is read
// while the popup is closed.

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;
  if (isComingUpTrackMessage(data)) {
    comingUpStore.setTrack({ videoId: data.videoId, title: data.title, artist: data.artist });
    return;
  }
  if (isNextTrackArtworkMessage(data)) comingUpStore.setArtwork(data.videoId, data.artworkUrl);
});

function requestComingUp(): void {
  const request: RequestComingUpMessage = { type: "blk-request-coming-up" };
  window.postMessage(request, window.location.origin);
}

// -- Better Lyrics probe, answered whether or not the fader is mounted ---------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isHasBetterLyricsCommand(message)) {
    const reply: BetterLyricsPresenceMessage = { type: "blk-better-lyrics-presence", present: hasBetterLyrics() };
    sendResponse(reply);
    return undefined;
  }

  // Answered even with no pipeline running, so the popup can hide the band
  // rather than wait out a timeout.
  if (isGetComingUpCommand(message)) {
    // Answered from the last known record, then refreshed for the popup's next
    // poll. The world hop is asynchronous and this reply cannot wait for it.
    sendResponse({ type: "blk-coming-up", track: comingUpStore.get() } satisfies ComingUpMessage);
    requestComingUp();
    return undefined;
  }

  return undefined;
});
