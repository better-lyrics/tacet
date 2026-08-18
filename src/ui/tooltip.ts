import { resolveCardAnchor } from "@/ui/card-anchor";
import { computeCardPosition } from "@/ui/fader-position";

// -- Hover card --------------------------------------------------------------

const TOOLTIP_CLASS = "blyrics-mix-tip";
const LINE_CLASS = "blyrics-mix-tip__line";
const PERCENT_CLASS = "blyrics-mix-tip__pct";
const NOTE_CLASS = "blyrics-mix-tip__note";
const NOTE_SHOWN_CLASS = "is-shown";

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 160;
const ROLL_MS = 320;
const TOOLTIP_GAP_PX = 14;

interface TooltipContent {
  label: string;
  percent: number | null;
  note?: string | null;
}

interface Tooltip {
  setContent(content: TooltipContent | null): void;
  setSuppressed(suppressed: boolean): void;
  destroy(): void;
}

function sameStep(a: TooltipContent | null, b: TooltipContent): boolean {
  return a !== null && a.label === b.label;
}

function percentText(percent: number): string {
  return `${Math.round(Math.min(1, Math.max(0, percent)) * 100)}%`;
}

function fillLine(line: HTMLSpanElement, content: TooltipContent): void {
  line.textContent = content.percent === null ? content.label : `${content.label} `;
  if (content.percent === null) return;
  const percent = document.createElement("span");
  percent.className = PERCENT_CLASS;
  percent.textContent = percentText(content.percent);
  line.appendChild(percent);
}

function buildLine(content: TooltipContent): HTMLSpanElement {
  const line = document.createElement("span");
  line.className = `${LINE_CLASS} is-entering`;
  fillLine(line, content);
  line.addEventListener("animationend", () => line.classList.remove("is-entering"), { once: true });
  return line;
}

function createTooltip(trigger: HTMLElement): Tooltip {
  const card = document.createElement("div");
  card.className = TOOLTIP_CLASS;
  card.setAttribute("role", "tooltip");
  const stack = document.createElement("span");
  stack.className = "blyrics-mix-tip__stack";
  card.appendChild(stack);

  const note = document.createElement("span");
  note.className = NOTE_CLASS;
  card.appendChild(note);

  const ruler = document.createElement("span");
  ruler.className = "blyrics-mix-tip__ruler";
  card.appendChild(ruler);

  document.body.appendChild(card);

  let content: TooltipContent | null = null;
  let cardWidth = 0;
  let open = false;
  let suppressed = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (openTimer !== null) clearTimeout(openTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  }

  function fitTo(next: TooltipContent): void {
    fillLine(ruler, next);
    let widest = Math.ceil(ruler.getBoundingClientRect().width);
    if (next.note) {
      ruler.textContent = next.note;
      widest = Math.max(widest, Math.ceil(ruler.getBoundingClientRect().width));
    }
    cardWidth = widest;
    card.style.width = `${cardWidth}px`;
  }

  function applyNote(text: string | null | undefined): void {
    if (text) note.textContent = text;
    note.classList.toggle(NOTE_SHOWN_CLASS, Boolean(text));
    note.setAttribute("aria-hidden", String(!text));
  }

  function place(): void {
    const triggerRect = trigger.getBoundingClientRect();
    const dock = trigger.closest<HTMLElement>("[data-position]");
    const anchor = resolveCardAnchor(trigger, trigger, TOOLTIP_GAP_PX);
    const anchorRect = anchor.element.getBoundingClientRect();
    const position = computeCardPosition(
      { left: triggerRect.left, width: triggerRect.width },
      { top: anchorRect.top, bottom: anchorRect.bottom },
      { width: cardWidth, height: card.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      dock?.dataset.position ?? null,
      anchor.gap
    );
    card.style.left = `${position.left}px`;
    card.style.top = position.top;
    card.style.bottom = position.bottom;
  }

  function show(): void {
    if (open || suppressed || !content) return;
    open = true;
    place();
    card.classList.add("is-open");
  }

  function setSuppressed(next: boolean): void {
    if (suppressed === next) return;
    suppressed = next;
    if (!suppressed) return;
    clearTimers();
    hide();
  }

  function hide(): void {
    open = false;
    card.classList.remove("is-open");
  }

  function setContent(next: TooltipContent | null): void {
    if (!next) {
      content = null;
      hide();
      return;
    }

    fitTo(next);
    applyNote(next.note);

    const previous = stack.querySelector<HTMLSpanElement>(`.${LINE_CLASS}:not(.is-leaving)`);

    if (previous && sameStep(content, next) && next.percent !== null) {
      const percent = previous.querySelector(`.${PERCENT_CLASS}`);
      if (percent) {
        percent.textContent = percentText(next.percent);
        content = next;
        if (open) place();
        return;
      }
    }

    if (previous) {
      previous.classList.remove("is-entering");
      previous.classList.add("is-leaving");
      previous.addEventListener("animationend", () => previous.remove(), { once: true });
      setTimeout(() => previous.remove(), ROLL_MS + 200);
    }
    stack.appendChild(buildLine(next));

    content = next;
    if (open) place();
  }

  function onEnter(): void {
    clearTimers();
    if (suppressed) return;
    openTimer = setTimeout(show, OPEN_DELAY_MS);
  }

  function onLeave(): void {
    clearTimers();
    closeTimer = setTimeout(hide, CLOSE_DELAY_MS);
  }

  trigger.addEventListener("pointerenter", onEnter);
  trigger.addEventListener("pointerleave", onLeave);
  trigger.addEventListener("focus", show);
  trigger.addEventListener("blur", hide);

  function destroy(): void {
    clearTimers();
    trigger.removeEventListener("pointerenter", onEnter);
    trigger.removeEventListener("pointerleave", onLeave);
    trigger.removeEventListener("focus", show);
    trigger.removeEventListener("blur", hide);
    card.remove();
  }

  return { setContent, setSuppressed, destroy };
}

export { createTooltip, TOOLTIP_CLASS };
export type { Tooltip, TooltipContent };
