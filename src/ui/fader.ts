import { shouldShowActivePill } from "@/ui/armed-affordance";
import { isFaderInteractive, shouldCloseForDisabled } from "@/ui/fader-disabled-gate";
import {
  dockCouplingCardClosed,
  dockCouplingCardOpened,
  dockCouplingShouldCloseCard,
  initialDockCouplingState,
} from "@/ui/fader-dock-coupling";
import {
  CARD_GAP_PX,
  HOLD_MS,
  LABEL_EXIT_FALLBACK_MS,
  LABEL_HIDE_MS,
  computeCommit,
  computePaintFrame,
  glyphSizeFor,
  stepValue,
  valueFromPointerOffset,
} from "@/ui/fader-geometry";
import { type CardAnchor, DOCK_PILL_SELECTOR, resolveCardAnchor } from "@/ui/card-anchor";
import { createFilledGlyphSvg, createGlyphMaskUrl } from "@/ui/fader-icons";
import { computeCardPosition } from "@/ui/fader-position";
import { createSpring } from "@/ui/spring";
import type { Spring, SpringDeps, SpringMode } from "@/ui/spring";
import { wipeElapsedMs } from "@/ui/wipe-anchor";

type FaderHost = "dock" | "bar";
type GlyphKind = "mic" | "note";
type GlyphLayerKind = GlyphKind | "busy";

// -- Better Lyrics' own dock classes, reused rather than restyled --------------
const DOCK_CONTROL_CLASS = "blyrics-dock__control";
const DOCK_CONTROL_ACTIVE_CLASS = "blyrics-dock__control--active";
const DOCK_MENU_CLASS = "blyrics-dock__menu";
const DOCK_MENU_OPEN_CLASS = "blyrics-dock__menu--open";
const BAR_CONTROL_CLASS = "blyrics-sing--bar";
const BAR_MENU_CLASS = "blyrics-mix--bar";
const DOCK_EXPANDED_CLASS = "blyrics-dock__inner--expanded";

interface CreateFaderControlOptions {
  host?: FaderHost;
  onChange(mixLevel: number): void;
  onOpenChange?(open: boolean): void;
  requestAnimationFrame?: SpringDeps["requestAnimationFrame"];
  prefersReducedMotion?: SpringDeps["prefersReducedMotion"];
}

interface FaderControl {
  button: HTMLButtonElement;
  menu: HTMLDivElement;
  getHost(): FaderHost;
  setHost(next: FaderHost): void;
  setBusy(busy: boolean): void;
  showCrossfade(durationSeconds: number): void;
  reanchorWipe(): void;
  destroy(): void;
}

// -- Glyph stack --------------------------------------------------------------

interface GlyphStack {
  el: HTMLSpanElement;
  show(kind: GlyphLayerKind, fraction: number, busyKind?: GlyphKind): void;
  setSize(next: number): void;
}

function createGlyphStack(initialSize: number): GlyphStack {
  let size = initialSize;
  const el = document.createElement("span");
  el.style.position = "absolute";
  el.style.inset = "0";

  const micLayer = document.createElement("span");
  micLayer.className = "blyrics-sing__glyph";
  micLayer.dataset.kind = "mic";

  const noteLayer = document.createElement("span");
  noteLayer.className = "blyrics-sing__glyph";
  noteLayer.dataset.kind = "note";

  const busyLayer = document.createElement("span");
  busyLayer.className = "blyrics-sing__glyph blyrics-sing__glyph--busy";
  const busyInner = document.createElement("span");
  busyLayer.appendChild(busyInner);

  el.append(micLayer, noteLayer, busyLayer);

  const layers: Record<GlyphLayerKind, HTMLElement> = { mic: micLayer, note: noteLayer, busy: busyLayer };
  const shownFraction: Partial<Record<GlyphKind, string>> = {};
  let shownKind: GlyphLayerKind | null = null;
  let shownBusyKind: GlyphKind | null = null;

  function show(kind: GlyphLayerKind, fraction: number, busyKind?: GlyphKind): void {
    if (kind === "busy") {
      const wanted = busyKind ?? "mic";
      if (shownBusyKind !== wanted) {
        shownBusyKind = wanted;
        busyInner.style.setProperty("--glyph", createGlyphMaskUrl(wanted));
      }
    } else if (shownFraction[kind] !== String(fraction)) {
      shownFraction[kind] = String(fraction);
      layers[kind].replaceChildren(createFilledGlyphSvg(kind, fraction, size));
    }

    if (shownKind === kind) return;
    shownKind = kind;
    for (const [name, node] of Object.entries(layers)) {
      node.classList.toggle("blyrics-sing__glyph--on", name === kind);
    }
  }

  function setSize(next: number): void {
    if (next === size) return;
    size = next;
    for (const kind of ["mic", "note"] as const) {
      const fraction = shownFraction[kind];
      if (fraction === undefined) continue;
      layers[kind].replaceChildren(createFilledGlyphSvg(kind, Number(fraction), size));
    }
  }

  return { el, show, setSize };
}

// -- Track ---------------------------------------------------------------------

interface Track {
  track: HTMLDivElement;
  clip: HTMLDivElement;
  fill: HTMLDivElement;
  thumb: HTMLDivElement;
}

function createTrack(): Track {
  const track = document.createElement("div");
  track.className = "blyrics-mix-track";
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", "Sing-along");
  track.setAttribute("aria-valuemin", "-100");
  track.setAttribute("aria-valuemax", "0");

  const well = document.createElement("div");
  well.className = "blyrics-mix-well";
  const clip = document.createElement("div");
  clip.className = "blyrics-mix-clip";
  const fill = document.createElement("div");
  fill.className = "blyrics-mix-fill";
  const thumb = document.createElement("div");
  thumb.className = "blyrics-mix-thumb";

  clip.append(fill, thumb);
  well.appendChild(clip);
  track.appendChild(well);

  return { track, clip, fill, thumb };
}

// -- The control ---------------------------------------------------------------

function createFaderControl(options: CreateFaderControlOptions): FaderControl {
  let host: FaderHost = options.host ?? "dock";
  const requestFrame: SpringDeps["requestAnimationFrame"] =
    options.requestAnimationFrame ?? ((callback: (time: number) => void) => window.requestAnimationFrame(callback));
  const prefersReducedMotion: SpringDeps["prefersReducedMotion"] =
    options.prefersReducedMotion ?? (() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "blyrics-sing";
  button.classList.add(host === "dock" ? DOCK_CONTROL_CLASS : BAR_CONTROL_CLASS);
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Sing-along");

  const stack = createGlyphStack(glyphSizeFor(host));
  button.appendChild(stack.el);

  const menu = document.createElement("div");
  menu.className = "blyrics-mix";
  menu.classList.add(host === "dock" ? DOCK_MENU_CLASS : BAR_MENU_CLASS);
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Sing-along level");

  const { track, clip, fill, thumb } = createTrack();
  const readout = document.createElement("div");
  readout.className = "blyrics-mix-readout";

  menu.append(track, readout);
  document.body.appendChild(menu);

  let v = 0;

  const isMarkedDisabled = (): boolean => button.getAttribute("aria-disabled") === "true";

  // -- Placement --------------------------------------------------------------
  function cardAnchor(): CardAnchor {
    const pill = button.closest<HTMLElement>(DOCK_PILL_SELECTOR);
    return resolveCardAnchor(button, pill ?? button, CARD_GAP_PX);
  }

  function currentDataPosition(): string | null {
    if (host === "bar") return null;
    const dock = button.closest<HTMLElement>(".blyrics-dock");
    return dock?.dataset.position ?? null;
  }

  function place(): void {
    const anchor = cardAnchor();
    const position = computeCardPosition(
      button.getBoundingClientRect(),
      anchor.element.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      currentDataPosition(),
      anchor.gap
    );
    menu.style.left = `${position.left}px`;
    menu.style.top = position.top;
    menu.style.bottom = position.bottom;
    menu.classList.toggle("blyrics-mix--down", position.opensDown);
    menu.classList.toggle("blyrics-mix--up", !position.opensDown);
  }

  // -- Paint --------------------------------------------------------------------

  // -- Busy state -----------------------------------------------------------

  let busy = false;
  let lastGlyphKind: GlyphKind = "mic";
  let lastGlyphFraction = 0;
  let committedValue = 0;

  function syncActivePill(): void {
    const active = shouldShowActivePill(committedValue, busy);
    button.classList.toggle("blyrics-sing--active", active);
    button.classList.toggle(DOCK_CONTROL_ACTIVE_CLASS, active);
  }

  function setBusy(nextBusy: boolean): void {
    if (busy === nextBusy) return;
    busy = nextBusy;
    if (busy) stack.show("busy", 1, lastGlyphKind);
    else stack.show(lastGlyphKind, lastGlyphFraction);
    syncActivePill();
  }

  const paint: Spring = createSpring(
    x => {
      const frame = computePaintFrame(x);
      thumb.style.top = `${frame.thumbCenterPercent}%`;
      fill.style.top = `${frame.fillTopPercent}%`;
      fill.style.height = `${frame.fillHeightPercent}%`;
      thumb.style.setProperty("--shadow-y", `${frame.shadowYPx.toFixed(2)}px`);
      lastGlyphKind = frame.glyphKind;
      lastGlyphFraction = frame.glyphFraction;
      if (busy) stack.show("busy", 1, frame.glyphKind);
      else stack.show(frame.glyphKind, frame.glyphFraction);
    },
    { requestAnimationFrame: requestFrame, prefersReducedMotion }
  );

  // -- Transient label ------------------------------------------------------------

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let shownWord: string | null = null;

  function flashLabel(text: string): void {
    readout.classList.add("blyrics-mix-readout--visible");
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => readout.classList.remove("blyrics-mix-readout--visible"), LABEL_HIDE_MS);
    if (text === shownWord) return;
    shownWord = text;

    const leaving = readout.querySelector<HTMLElement>(".blyrics-mix-word:not(.blyrics-mix-word--exit)");
    if (leaving) {
      leaving.classList.add("blyrics-mix-word--exit");
      leaving.addEventListener("transitionend", () => leaving.remove(), { once: true });
      setTimeout(() => leaving.remove(), LABEL_EXIT_FALLBACK_MS);
    }

    const entering = document.createElement("span");
    entering.className = "blyrics-mix-word blyrics-mix-word--enter";
    entering.textContent = text;
    readout.appendChild(entering);
    requestFrame(() => requestFrame(() => entering.classList.remove("blyrics-mix-word--enter")));
  }

  // -- Commit -----------------------------------------------------------------

  function commit(mode: SpringMode, announce = true): void {
    const frame = computeCommit(v);
    paint.set(frame.effectiveValue, mode);
    committedValue = frame.effectiveValue;
    syncActivePill();
    track.dataset.rest = String(frame.effectiveValue === 0);
    track.setAttribute("aria-valuenow", String(Math.round(frame.effectiveValue * 100)));
    track.setAttribute("aria-valuetext", frame.label);
    if (announce) flashLabel(frame.label);
    options.onChange(frame.mixLevel);
  }

  // -- Dock expansion coupling --------------------------------------------------

  function dockInnerElement(): HTMLElement | null {
    return button.closest<HTMLElement>(".blyrics-dock__inner");
  }

  let dockCouplingState = initialDockCouplingState();
  let dockClassObserver: MutationObserver | null = null;
  let pointerOnCard = false;

  menu.addEventListener("pointerenter", () => {
    pointerOnCard = true;
  });
  menu.addEventListener("pointerleave", () => {
    pointerOnCard = false;
    const inner = dockInnerElement();
    if (inner && dockCouplingShouldCloseCard(open, inner.classList.contains(DOCK_EXPANDED_CLASS), false)) {
      setOpen(false);
    }
  });

  function stopWatchingDockCollapse(): void {
    dockClassObserver?.disconnect();
    dockClassObserver = null;
  }

  function watchDockCollapse(inner: HTMLElement): void {
    stopWatchingDockCollapse();
    dockClassObserver = new MutationObserver(() => {
      const expanded = inner.classList.contains(DOCK_EXPANDED_CLASS);
      if (dockCouplingShouldCloseCard(open, expanded, pointerOnCard)) setOpen(false);
    });
    dockClassObserver.observe(inner, { attributes: true, attributeFilter: ["class"] });
  }

  function syncDockExpansion(next: boolean): void {
    if (host !== "dock") return;
    const inner = dockInnerElement();
    if (!inner) return;

    if (next) {
      const result = dockCouplingCardOpened(inner.classList.contains(DOCK_EXPANDED_CLASS));
      dockCouplingState = result.state;
      if (result.addExpandedClass) inner.classList.add(DOCK_EXPANDED_CLASS);
      watchDockCollapse(inner);
    } else {
      const result = dockCouplingCardClosed(dockCouplingState);
      dockCouplingState = result.state;
      if (result.removeExpandedClass) inner.classList.remove(DOCK_EXPANDED_CLASS);
      stopWatchingDockCollapse();
    }
  }

  // -- Open / close -------------------------------------------------------------

  let open = false;

  function setOpen(next: boolean): void {
    open = next;
    if (next) place();
    syncDockExpansion(next);
    menu.classList.toggle("blyrics-mix--open", next);
    menu.classList.toggle(DOCK_MENU_OPEN_CLASS, next);
    button.setAttribute("aria-expanded", String(next));
    options.onOpenChange?.(next);
    if (next) track.focus();
  }

  function onResize(): void {
    if (open) place();
  }
  function onScroll(): void {
    if (open) place();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, { passive: true });

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdHandled = false;

  function clearHold(): void {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
  }

  button.addEventListener("pointerdown", () => {
    if (!isFaderInteractive(isMarkedDisabled())) return;
    holdHandled = false;
    holdTimer = setTimeout(() => {
      if (!isFaderInteractive(isMarkedDisabled())) return;
      holdHandled = true;
      setOpen(true);
    }, HOLD_MS);
  });
  button.addEventListener("pointerup", clearHold);
  button.addEventListener("pointerleave", clearHold);
  button.addEventListener("click", () => {
    if (holdHandled) return;
    if (!isFaderInteractive(isMarkedDisabled())) return;
    v = v === 0 ? -1 : 0;
    commit("settle");
  });
  button.addEventListener("dblclick", () => {
    if (!isFaderInteractive(isMarkedDisabled())) return;
    setOpen(true);
  });
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!isFaderInteractive(isMarkedDisabled())) return;
      event.preventDefault();
      setOpen(true);
    }
  });

  function onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target && !menu.contains(target) && !button.contains(target)) setOpen(false);
  }
  document.addEventListener("pointerdown", onDocumentPointerDown);

  // -- Disabled gate --------------------------------------------------------

  const disabledObserver = new MutationObserver(() => {
    if (shouldCloseForDisabled(open, isMarkedDisabled())) setOpen(false);
  });
  disabledObserver.observe(button, { attributes: true, attributeFilter: ["aria-disabled"] });

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      setOpen(false);
      button.focus();
    }
  }
  menu.addEventListener("keydown", onMenuKeydown);

  // -- Track: drag, double-click reset, keys -------------------------------------

  track.addEventListener("pointerdown", event => {
    event.preventDefault();
    track.focus();
    track.setPointerCapture(event.pointerId);

    function apply(pointerEvent: PointerEvent): void {
      const rect = clip.getBoundingClientRect();
      v = valueFromPointerOffset(pointerEvent.clientY, rect.top, rect.height);
      commit("drag");
    }
    apply(event);

    function onPointerMove(pointerEvent: PointerEvent): void {
      apply(pointerEvent);
    }
    function onPointerUp(): void {
      commit("settle");
      track.removeEventListener("pointermove", onPointerMove);
      track.removeEventListener("pointerup", onPointerUp);
    }
    track.addEventListener("pointermove", onPointerMove);
    track.addEventListener("pointerup", onPointerUp);
  });

  track.addEventListener("dblclick", () => {
    v = 0;
    commit("settle");
  });

  track.addEventListener("keydown", event => {
    const big = event.shiftKey;
    if (event.key === "ArrowUp") v = stepValue(v, 1, big);
    else if (event.key === "ArrowDown") v = stepValue(v, -1, big);
    else if (event.key === "Home") v = 0;
    else return;
    event.preventDefault();
    commit("settle");
  });

  commit("settle", false);
  paint.jump(0);

  // -- Crossfade wipe ---------------------------------------------------------

  let wipe: HTMLSpanElement | null = null;
  let wipeTimer: ReturnType<typeof setTimeout> | null = null;
  let wipeStartedAtMs = 0;
  let wipeDurationMs = 0;

  function clearWipe(): void {
    if (wipeTimer !== null) clearTimeout(wipeTimer);
    wipeTimer = null;
    wipe?.remove();
    wipe = null;
  }

  function anchorWipe(): void {
    if (wipe === null || typeof wipe.getAnimations !== "function") return;
    const elapsed = wipeElapsedMs(wipeStartedAtMs, performance.now(), wipeDurationMs);
    for (const animation of wipe.getAnimations({ subtree: true })) animation.currentTime = elapsed;
  }

  function showCrossfade(durationSeconds: number): void {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
    clearWipe();

    const band = document.createElement("i");
    wipe = document.createElement("span");
    wipe.className = "blyrics-sing__wipe";
    wipeDurationMs = Math.round(durationSeconds * 1000);
    wipeStartedAtMs = performance.now();
    wipe.style.setProperty("--fade-ms", `${wipeDurationMs}ms`);
    wipe.appendChild(band);
    button.appendChild(wipe);
    wipeTimer = setTimeout(clearWipe, wipeDurationMs);
  }

  function setHost(next: FaderHost): void {
    host = next;
    stack.setSize(glyphSizeFor(next));
    button.classList.toggle(DOCK_CONTROL_CLASS, next === "dock");
    button.classList.toggle(BAR_CONTROL_CLASS, next === "bar");
    menu.classList.toggle(DOCK_MENU_CLASS, next === "dock");
    menu.classList.toggle(BAR_MENU_CLASS, next === "bar");
    if (next !== "dock") stopWatchingDockCollapse();
    // Every remount arrives through here, and a remount is what restarts the
    // wipe, so this is the one place that has to put it back where the clock
    // says it should be.
    anchorWipe();
  }

  function destroy(): void {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    disabledObserver.disconnect();
    stopWatchingDockCollapse();
    clearHold();
    clearWipe();
    if (hideTimer !== null) clearTimeout(hideTimer);
    menu.remove();
    button.remove();
  }

  return { button, menu, getHost: () => host, setHost, setBusy, showCrossfade, reanchorWipe: anchorWipe, destroy };
}

export { createFaderControl };
export type { FaderHost, CreateFaderControlOptions, FaderControl };
