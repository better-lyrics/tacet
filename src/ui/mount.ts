import type { FaderPlacement } from "@/settings/settings";
import type { FaderControl } from "@/ui/fader";
import { createMountResolver } from "@/ui/hysteresis";
import type { MountTarget } from "@/ui/hysteresis";

const BETTER_LYRICS_STYLE_LINK_SELECTOR = 'link[id^="blyrics-style-"]';
const DOCK_CONTROLS_SELECTOR = ".blyrics-dock__controls";
const PLAYER_BAR_VOLUME_BUTTON_SELECTOR = "ytmusic-player-bar .right-controls-buttons yt-icon-button.volume";

const DOCK_DIVIDER_CLASS = "blyrics-dock__divider";

function needsDockDivider(dockChildren: readonly unknown[], ours: readonly unknown[]): boolean {
  return dockChildren.some(child => !ours.includes(child));
}

function hasBetterLyrics(root: ParentNode = document): boolean {
  return root.querySelector(BETTER_LYRICS_STYLE_LINK_SELECTOR) !== null;
}

type FaderMountControl = Pick<FaderControl, "button" | "setHost">;

interface AttachFaderMountOptions {
  placement?: FaderPlacement;
  observeRoot?: Node;
  leaveDelayVisibleMs?: number;
  leaveDelayAbsentMs?: number;
  requestAnimationFrame?(callback: () => void): number;
}

interface FaderMountHandle {
  setPlacement(next: FaderPlacement): void;
  disconnect(): void;
}

function attachFaderMount(control: FaderMountControl, options: AttachFaderMountOptions = {}): FaderMountHandle {
  const requestFrame = options.requestAnimationFrame ?? (callback => window.requestAnimationFrame(callback));
  const observeRoot = options.observeRoot ?? document.body;
  let placement: FaderPlacement = options.placement ?? "dock";

  function dockControlsElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>(DOCK_CONTROLS_SELECTOR);
  }

  function volumeButtonElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>(PLAYER_BAR_VOLUME_BUTTON_SELECTOR);
  }

  const divider = document.createElement("span");
  divider.className = DOCK_DIVIDER_CLASS;

  function mountTo(target: MountTarget): void {
    if (target === "dock") {
      const dock = dockControlsElement();
      if (!dock) return;
      if (needsDockDivider(Array.from(dock.children), [control.button, divider])) dock.appendChild(divider);
      else divider.remove();
      dock.appendChild(control.button);
    } else {
      const volumeButton = volumeButtonElement();
      if (!volumeButton) return;
      divider.remove();
      volumeButton.insertAdjacentElement("afterend", control.button);
    }
    control.setHost(target);
  }

  const resolver = createMountResolver({
    leaveDelayVisibleMs: options.leaveDelayVisibleMs,
    leaveDelayAbsentMs: options.leaveDelayAbsentMs,
    isDockPresent: () => placement === "dock" && dockControlsElement() !== null,
    isControlMountedToDock: () => control.button.parentElement === dockControlsElement(),
    isControlMountedToBar: () => control.button.parentElement === (volumeButtonElement()?.parentElement ?? null),
    isControlVisible: () => control.button.isConnected,
    mountTo,
  });

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestFrame(() => {
      queued = false;
      resolver.resolve();
    });
  });
  observer.observe(observeRoot, { childList: true, subtree: true });

  resolver.resolve(true);

  return {
    setPlacement(next) {
      if (next === placement) return;
      placement = next;
      resolver.resolve(true);
    },
    disconnect() {
      observer.disconnect();
      resolver.dispose();
      divider.remove();
    },
  };
}

export {
  BETTER_LYRICS_STYLE_LINK_SELECTOR,
  DOCK_CONTROLS_SELECTOR,
  DOCK_DIVIDER_CLASS,
  PLAYER_BAR_VOLUME_BUTTON_SELECTOR,
  hasBetterLyrics,
  needsDockDivider,
  attachFaderMount,
};
export type { FaderMountControl, AttachFaderMountOptions, FaderMountHandle };
