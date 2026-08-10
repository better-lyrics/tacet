import faderCss from "data-text:../ui/fader.css";
import type { PlasmoCSConfig } from "plasmo";
import { describeBusy } from "@/orchestrator/busy-tooltip";
import { createKaraokePipeline } from "@/orchestrator/karaoke-pipeline";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { SETTINGS_STORAGE_KEY, sanitizeSettings } from "@/settings/settings";
import type { FaderPlacement, Settings } from "@/settings/settings";
import { loadSettingsFrom } from "@/settings/storage";
import { NEUTRAL_MIX_LEVEL } from "@/pageworld/gain-law";
import { createFaderControl } from "@/ui/fader";
import type { FaderControl } from "@/ui/fader";
import { attachFaderMount, hasBetterLyrics } from "@/ui/mount";
import { createTooltip } from "@/ui/tooltip";
import type { Tooltip } from "@/ui/tooltip";
import { createLogger } from "@/shared/logger";
import { extensionVersion } from "@/shared/version";
import { type BetterLyricsPresenceMessage, isHasBetterLyricsCommand } from "../../workers/protocol2";

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

interface MountedFader {
  destroy(): void;
  setPlacement(next: FaderPlacement): void;
  setCrossfadeSeconds(seconds: number): void;
}

function mountFader(placement: FaderPlacement, crossfadeSeconds: number): MountedFader {
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
    onCrossfadeStarted: durationSeconds => control.showCrossfade(durationSeconds),
  });

  const mount = attachFaderMount({ button: control.button, setHost: control.setHost }, { placement });
  pipeline.setCrossfadeSeconds(crossfadeSeconds);

  return {
    setPlacement: mount.setPlacement,
    setCrossfadeSeconds: seconds => pipeline?.setCrossfadeSeconds(seconds),
    destroy() {
      mount.disconnect();
      // First, since it is what hands the audio back to the original.
      pipeline?.destroy();
      tooltip.destroy();
      control.destroy();
    },
  };
}

let mounted: MountedFader | null = null;

function applySettings(settings: Settings): void {
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

// -- Better Lyrics probe, answered whether or not the fader is mounted ---------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isHasBetterLyricsCommand(message)) return undefined;
  const reply: BetterLyricsPresenceMessage = { type: "blk-better-lyrics-presence", present: hasBetterLyrics() };
  sendResponse(reply);
  return undefined;
});
