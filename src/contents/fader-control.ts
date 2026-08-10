import faderCss from "data-text:../ui/fader.css";
import type { PlasmoCSConfig } from "plasmo";
import { describeBusy } from "@/orchestrator/busy-tooltip";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { SETTINGS_STORAGE_KEY, sanitizeSettings } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import { NEUTRAL_MIX_LEVEL } from "@/pageworld/gain-law";
import { createFaderControl } from "@/ui/fader";
import type { FaderControl } from "@/ui/fader";
import { attachFaderMount, hasBetterLyrics } from "@/ui/mount";
import { createTooltip } from "@/ui/tooltip";
import type { Tooltip } from "@/ui/tooltip";
import { createLogger } from "@/shared/logger";
import { extensionVersion } from "@/shared/version";

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

function mountFader(): { destroy(): void } {
  injectStylesheet();

  let pipeline: ReturnType<typeof createKaraokePipeline> | undefined;
  let tooltip: Tooltip | undefined;
  let latest: KaraokeState | null = null;
  let armed = false;

  function render(): void {
    if (latest && tooltip) renderKaraokeState(control, tooltip, latest, armed);
  }

  const control = createFaderControl({
    host: hasBetterLyrics() ? "dock" : "bar",
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

  const mount = attachFaderMount({ button: control.button, setHost: control.setHost });

  return {
    destroy() {
      mount.disconnect();
      // First, since it is what hands the audio back to the original.
      pipeline?.destroy();
      tooltip.destroy();
      control.destroy();
    },
  };
}

let mounted: { destroy(): void } | null = null;

function applySingAlong(enabled: boolean): void {
  if (enabled === (mounted !== null)) return;
  if (enabled) {
    mounted = mountFader();
    logger.log("sing-along on");
    return;
  }
  mounted?.destroy();
  mounted = null;
  logger.log("sing-along off");
}

loadSettingsFrom(chrome.storage.sync)
  .then(settings => applySingAlong(settings.singAlongEnabled))
  .catch(error => {
    logger.error("failed to check the sing-along setting", error);
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(SETTINGS_STORAGE_KEY in changes)) return;
  applySingAlong(sanitizeSettings(changes[SETTINGS_STORAGE_KEY].newValue).singAlongEnabled);
});
