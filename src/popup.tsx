import "./popup.css";
import tacetIconUrl from "data-base64:../assets/brand/logo.png";
import Sortable from "sortablejs";
import { sanitizeSourcePreferences } from "@/acquisition/sources";
import type { SourcePreference, SourceSpeed, SourceSpeedRank } from "@/acquisition/sources";
import { type ModelVariant, getModelDescriptor } from "@/cache/model-url";
import { sizedArtworkUrl } from "@/capture/artwork-url";
import { separationFill, separationText } from "@/orchestrator/separation-status";
import { formatBytes } from "@/settings/format-bytes";
import {
  POPUP_TABS,
  type PopupTab,
  type PopupView,
  activePanel,
  initialView,
  isStatusVisible,
  isTabBarVisible,
  selectTab,
  toggleAbout,
} from "@/settings/popup-tabs";
import { describeNowArtist } from "@/orchestrator/delivery";
import { createSelect } from "@/settings/select";
import { acquisitionWarning, moveSource, sourceRows, toggleSource } from "@/settings/source-rows";
import {
  CACHE_BUDGET_PRESETS_BYTES,
  CROSSFADE_PRESETS_SECONDS,
  DEFAULT_SETTINGS,
  type FaderPlacement,
} from "@/settings/settings";
import { loadSettingsFrom, saveSettingsFrom } from "@/settings/storage";
import { extensionVersion } from "@/shared/version";
import {
  type ClearModelCacheCommand,
  type ClearStemCacheCommand,
  type GetCacheStatusCommand,
  type GetTrackStatusCommand,
  type HasBetterLyricsCommand,
  type TrackStatusMessage,
  isBetterLyricsPresenceMessage,
  isCacheStatusMessage,
  isClearCacheResultMessage,
  isTrackStatusMessage,
} from "../workers/protocol2";

// -- Popup: settings, storage and About ----------------------------------------

const LOG_PREFIX = "[BLK-POPUP]";

// -- DOM helpers ------------------------------------------------------------

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

let labelIdCounter = 0;
function nextLabelId(): string {
  labelIdCounter++;
  return `blk-label-${labelIdCounter}`;
}

function createTextRow(labelText: string, hintText: string): { text: HTMLElement; hint: HTMLElement; labelId: string } {
  const text = createElement("div", "blk-row__text");
  const label = createElement("span", "blk-row__label");
  label.id = nextLabelId();
  label.textContent = labelText;
  const hint = createElement("span", "blk-row__hint");
  hint.textContent = hintText;
  text.append(label, hint);
  return { text, hint, labelId: label.id };
}

// -- Links and icons ------------------------------------------------------------

const BETTER_LYRICS_URL = "https://betterlyrics.org";
const REPOSITORY_URL = "https://github.com/better-lyrics/tacet";
const ISSUES_URL = "https://github.com/better-lyrics/tacet/issues/new/choose";
const DISCORD_URL = "https://discord.gg/UsHE3d5fWF";
const AUTHOR_URL = "https://boidu.dev";

const SVG_NS = "http://www.w3.org/2000/svg";
const GITHUB_MARK_PATH =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 " +
  "0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 " +
  "17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 " +
  "1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 " +
  "0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 " +
  "1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 " +
  "2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 " +
  "2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 " +
  "12.297c0-6.627-5.373-12-12-12";

const QUEUE_MARK_PATH =
  "M14 6H4c-.55 0-1 .45-1 1s.45 1 1 1h10c.55 0 1-.45 1-1s-.45-1-1-1m0 4H4c-.55 0-1 .45-1 " +
  "1s.45 1 1 1h10c.55 0 1-.45 1-1s-.45-1-1-1M4 16h6c.55 0 1-.45 1-1s-.45-1-1-1H4c-.55 " +
  "0-1 .45-1 1s.45 1 1 1M19 6c-1.1 0-2 .9-2 2v6.18c-.31-.11-.65-.18-1-.18c-1.84 0-3.28 " +
  "1.64-2.95 3.54c.21 1.21 1.2 2.2 2.41 2.41c1.9.33 3.54-1.11 3.54-2.95V8h2c.55 0 " +
  "1-.45 1-1s-.45-1-1-1z";

function createExternalLink(href: string, label: string, className: string): HTMLAnchorElement {
  const link = createElement("a", className);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = label;
  link.setAttribute("aria-label", label);
  return link;
}

function createFilledIcon(pathData: string, size: number, viewBox = "0 0 24 24"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function createInfoIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M12 11v5M12 7.6v.6");
  svg.append(circle, path);
  return svg;
}

function createHeader(): HTMLElement {
  const header = createElement("div", "blk-popup__header");

  const brand = createElement("img", "blk-popup__brand");
  brand.src = tacetIconUrl;
  brand.alt = "";
  brand.width = 22;
  brand.height = 22;

  const title = createElement("span", "blk-popup__title");
  title.textContent = "Tacet";
  const version = createElement("span", "blk-popup__version");
  version.textContent = extensionVersion();
  title.append(version);

  const repository = createExternalLink(REPOSITORY_URL, "View source on GitHub", "blk-icon-button");
  repository.append(createFilledIcon(GITHUB_MARK_PATH, 16));

  header.append(brand, title, repository);
  return header;
}

// -- Toggle switch ------------------------------------------------------------

interface Toggle {
  row: HTMLElement;
  setChecked(checked: boolean): void;
}

function createToggle(
  labelText: string,
  hintText: string,
  initialChecked: boolean,
  onToggle: (next: boolean) => void
): Toggle {
  const row = createElement("div", "blk-row");
  const { text, labelId } = createTextRow(labelText, hintText);

  const button = createElement("button", "blk-toggle");
  button.type = "button";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-labelledby", labelId);

  function render(checked: boolean): void {
    button.setAttribute("aria-checked", String(checked));
    button.classList.toggle("blk-toggle--on", checked);
  }
  render(initialChecked);

  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-checked") !== "true";
    render(next);
    onToggle(next);
  });

  row.append(text, button);
  return { row, setChecked: render };
}

// -- Cache budget slider -------------------------------------------------------

function closestPresetIndex(presets: readonly number[], bytes: number): number {
  let closestIndex = 0;
  let closestDiff = Number.POSITIVE_INFINITY;
  presets.forEach((preset, index) => {
    const diff = Math.abs(preset - bytes);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function createBudgetSlider(
  presets: readonly number[],
  initialBytes: number,
  onChange: (bytes: number) => void
): { row: HTMLElement } {
  const row = createElement("div", "blk-row blk-row--stack");
  const { text, hint, labelId } = createTextRow("Cache budget", "");
  text.classList.add("blk-row__text--slider");
  hint.textContent = "Maximum space used for cached vocals";

  const value = createElement("span", "blk-row__value");
  text.insertBefore(value, hint);

  const slider = createElement("input", "blk-slider");
  slider.type = "range";
  slider.setAttribute("aria-labelledby", labelId);
  slider.min = "0";
  slider.max = String(presets.length - 1);
  slider.step = "1";
  slider.value = String(closestPresetIndex(presets, initialBytes));

  function paint(): void {
    value.textContent = formatBytes(presets[Number(slider.value)]);
    const span = presets.length - 1;
    const fraction = span === 0 ? 0 : Number(slider.value) / span;
    slider.style.setProperty("--blk-fill", `${(fraction * 100).toFixed(2)}%`);
  }
  paint();

  slider.addEventListener("input", paint);
  slider.addEventListener("change", () => {
    onChange(presets[Number(slider.value)]);
  });

  row.append(text, slider);
  return { row };
}

// -- Model precision row -------------------------------------------------------

function approxMegabytes(variant: ModelVariant): string {
  return `${Math.round(getModelDescriptor(variant).approxBytes / (1024 * 1024))} MB`;
}

function createModelVariantRow(
  initial: ModelVariant,
  onChange: (next: ModelVariant) => void
): { row: HTMLElement; setValue(value: ModelVariant): void } {
  const row = createElement("div", "blk-row");
  const { text, labelId } = createTextRow(
    "Model precision",
    "Sounds pretty much the same and is slightly faster, at half the download. Applies from the next track. Switch to Full if one fails to separate."
  );

  const select = createSelect<ModelVariant>(
    [
      { value: "fp32", label: "Full", note: approxMegabytes("fp32") },
      { value: "fp16", label: "Half", note: approxMegabytes("fp16") },
    ],
    initial,
    onChange,
    labelId
  );

  row.append(text, select.element);
  return { row, setValue: select.setValue };
}

// -- Fader placement row -------------------------------------------------------

function createFaderPlacementRow(
  initial: FaderPlacement,
  onChange: (next: FaderPlacement) => void
): { row: HTMLElement; setValue(value: FaderPlacement): void } {
  const row = createElement("div", "blk-row");
  const { text, labelId } = createTextRow(
    "Sing-along position",
    "Where the sing-along button sits. The lyrics dock falls back to the player bar whenever it is not on screen."
  );

  const select = createSelect<FaderPlacement>(
    [
      { value: "dock", label: "Lyrics dock" },
      { value: "bar", label: "Player bar" },
    ],
    initial,
    onChange,
    labelId
  );

  row.append(text, select.element);
  return { row, setValue: select.setValue };
}

// -- Crossfade length row ------------------------------------------------------

function describeCrossfade(seconds: number): string {
  return seconds === 0 ? "Off" : `${seconds}s`;
}

function createCrossfadeRow(
  presets: readonly number[],
  initialSeconds: number,
  onChange: (next: number) => void
): { row: HTMLElement; setValue(value: number): void } {
  const row = createElement("div", "blk-row blk-row--stack");
  const { text, hint, labelId } = createTextRow("Crossfade", "");
  text.classList.add("blk-row__text--slider");
  hint.textContent = "Blend the end of one track into the start of the next";

  const value = createElement("span", "blk-row__value");
  text.insertBefore(value, hint);

  const slider = createElement("input", "blk-slider");
  slider.type = "range";
  slider.setAttribute("aria-labelledby", labelId);
  slider.min = "0";
  slider.max = String(presets.length - 1);
  slider.step = "1";
  slider.value = String(closestPresetIndex(presets, initialSeconds));

  function paint(): void {
    value.textContent = describeCrossfade(presets[Number(slider.value)]);
    slider.setAttribute("aria-valuetext", describeCrossfade(presets[Number(slider.value)]));
    const span = presets.length - 1;
    const fraction = span === 0 ? 0 : Number(slider.value) / span;
    slider.style.setProperty("--blk-fill", `${(fraction * 100).toFixed(2)}%`);
  }
  paint();

  slider.addEventListener("input", paint);
  slider.addEventListener("change", () => onChange(presets[Number(slider.value)]));

  row.append(text, slider);
  return {
    row,
    setValue: seconds => {
      slider.value = String(closestPresetIndex(presets, seconds));
      paint();
    },
  };
}

// -- Better Lyrics presence ----------------------------------------------------

async function probeBetterLyrics(): Promise<boolean> {
  const command: HasBetterLyricsCommand = { type: "blk-has-better-lyrics" };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return true;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, command);
    if (!isBetterLyricsPresenceMessage(response)) {
      console.error(`${LOG_PREFIX} unexpected Better Lyrics probe reply`, response);
      return true;
    }
    return response.present;
  } catch (error) {
    console.debug(`${LOG_PREFIX} no YouTube Music tab answered the Better Lyrics probe`, error);
    return true;
  }
}

// -- Storage readout -----------------------------------------------------------

interface CacheReadout {
  element: HTMLElement;
  setStems(value: string): void;
  setModel(value: string): void;
}

// -- Sources panel -------------------------------------------------------------

const DRAG_HANDLE_PATH =
  "M9 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0 " +
  "4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M14 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0 4a1.5 " +
  "1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0";

const SPEED_GAUGE_VIEW_BOX = "0 -960 960 960";
const SPEED_GAUGE_PX = 14;

const SPEED_GAUGE_1_PATH =
  "M480-316.5q38-.5 56-27.5l169-253q9-14-2.5-25.5T677-625L424-456q-27 18-28.5 55t22.5 61q24 24 62 " +
  "23.5Zm0-483.5q36 0 71 6t68 19q16 6 34 22.5t10 31.5q-8 15-36 20t-45-1q-25-9-50.5-13.5T480-720q-133 " +
  "0-226.5 93.5T160-400q0 42 11.5 83t32.5 77h552q23-38 " +
  "33.5-79t10.5-85q0-26-4.5-51T782-504q-6-17-2-33t18-27q13-10 28.5-6t21.5 18q15 35 23 71.5t9 74.5q1 " +
  "57-13 109t-41 99q-11 18-30 28t-40 10H204q-21 0-40-10t-30-28q-26-45-40-95.5T80-400q0-83 " +
  "31.5-155.5t86-127Q252-737 325-768.5T480-800Zm7 313Z";

const SPEED_GAUGE_2_PATH =
  "M448-328q34 14 65.5 2.5T555-372q22-74 40-146t34-145q4-18-12.5-25.5T589-682q-46 60-90.5 " +
  "119.5T410-440q-21 30-6.5 64t44.5 48ZM205-160q-21 0-40-9.5T135-198q-26-45-40-95.5T81-400q0-94 " +
  "39.5-173T227-708q57-47 126.5-71T496-800q16 1 24 14t6 29q-2 16-14.5 26.5T483-720q-55-1-108 18t-95 " +
  "54q-54 45-86.5 109T161-400q0 42 11.5 83t32.5 77h551q23-38 " +
  "33.5-78.5T800-400q0-59-22.5-116T717-615q-12-14-9-29t14-25q11-10 28-10.5t32 16.5q51 55 74.5 " +
  "124.5T880-400q0 53-13 104.5T826-198q-10 19-29.5 28.5T756-160H205Zm275-241Z";

const SPEED_GAUGE_3_PATH =
  "M513-328q30-14 44.5-48t-6.5-64q-44-63-88.5-122.5T372-682q-11-14-27.5-6.5T332-663q16 73 34 145t40 " +
  "146q10 35 41.5 46.5T513-328ZM205-160q-21 0-40.5-9.5T135-198q-28-46-41-97.5T81-400q0-69 " +
  "23.5-138.5T179-663q15-17 32-16.5t28 10.5q11 10 14 25t-9 29q-38 42-60.5 99T161-400q0 41 10.5 " +
  "81.5T205-240h551q21-36 32.5-77t11.5-83q0-75-32.5-139T681-648q-42-35-95-54t-108-18q-16 " +
  "0-28.5-10.5T435-757q-2-16 6-29t24-14q73-3 142.5 21T734-708q67 56 106.5 135T880-400q0 56-14 " +
  "106.5T826-198q-11 19-30 28.5t-40 9.5H205Zm276-241Z";

const SPEED_GAUGE_4_PATH =
  "M536-343q26-26 24-60.5T530-459q-60-47-122-87t-125-80q-14-9-26 3t-3 26q40 63 80 125.5T418-347q20 29 " +
  "56 29.5t62-25.5ZM205-160q-22 0-40.5-9.5T135-198q-28-48-42-100.5T79-406q0-35 7-69t21-66q6-15 " +
  "22-20.5t30 2.5q14 8 19.5 23.5T178-504q-9 24-14 49t-5 51q0 44 11.5 85.5T205-240h551q21-36 " +
  "32.5-76.5T800-400q0-133-93.5-226.5T480-720q-27 0-53 5t-51 14q-16 " +
  "5-31-.5T322-722q-8-15-2-30.5t21-21.5q33-13 68-19.5t71-6.5q83 0 155.5 31.5t127 86q54.5 54.5 86 " +
  "127T880-400q0 54-14 105t-40 97q-11 19-30 28.5t-40 9.5H205Zm274-238Z";

const SPEED_GAUGE_PATHS: Record<SourceSpeedRank, string> = {
  1: SPEED_GAUGE_1_PATH,
  2: SPEED_GAUGE_2_PATH,
  3: SPEED_GAUGE_3_PATH,
  4: SPEED_GAUGE_4_PATH,
};

function createSpeedGauge(speed: SourceSpeed): HTMLElement {
  const gauge = createElement("span", "blk-source__speed");
  gauge.setAttribute("role", "img");
  gauge.setAttribute("aria-label", speed.hint);
  gauge.title = speed.hint;
  gauge.append(createFilledIcon(SPEED_GAUGE_PATHS[speed.rank], SPEED_GAUGE_PX, SPEED_GAUGE_VIEW_BOX));
  return gauge;
}

interface SourcesPanel {
  element: HTMLElement;
  render(preferences: readonly SourcePreference[]): void;
}

function createSourcesPanel(
  initial: readonly SourcePreference[],
  onChange: (next: SourcePreference[]) => void
): SourcesPanel {
  const element = createElement("div", "blk-panel");
  element.setAttribute("role", "tabpanel");

  const heading = createElement("div", "blk-section");
  const title = createElement("span", "blk-section__title");
  title.textContent = "Where audio comes from";
  const hint = createElement("span", "blk-section__hint");
  hint.textContent =
    "Tacet tries these in order and keeps the first one that can deliver the whole track. Drag to reorder.";
  heading.append(title, hint);

  const list = createElement("div", "blk-sources");
  const warning = createElement("p", "blk-sources__warning");

  let preferences: SourcePreference[] = sanitizeSourcePreferences(initial);

  function commit(next: SourcePreference[]): void {
    preferences = next;
    onChange(preferences);
    render(preferences);
  }

  function render(next: readonly SourcePreference[]): void {
    preferences = sanitizeSourcePreferences(next);
    list.replaceChildren();

    for (const row of sourceRows(preferences)) {
      const item = createElement("div", "blk-source");
      item.dataset.sourceId = row.id;
      item.classList.toggle("blk-source--off", !row.enabled);

      const handle = createElement("span", "blk-source__handle");
      handle.append(createFilledIcon(DRAG_HANDLE_PATH, 16));
      handle.setAttribute("aria-hidden", "true");

      const text = createElement("div", "blk-source__text");
      const head = createElement("span", "blk-source__head");
      const name = createElement("span", "blk-source__name");
      name.id = nextLabelId();
      name.textContent = row.label;
      head.append(name, createSpeedGauge(row.speed));
      const detail = createElement("span", "blk-source__hint");
      detail.textContent = row.hint;
      text.append(head, detail);

      const toggle = createElement("button", "blk-toggle");
      toggle.type = "button";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-labelledby", name.id);
      toggle.setAttribute("aria-checked", String(row.enabled));
      toggle.classList.toggle("blk-toggle--on", row.enabled);
      toggle.addEventListener("click", () => commit(toggleSource(preferences, row.id)));

      item.append(handle, text, toggle);
      list.append(item);
    }

    const message = acquisitionWarning(preferences);
    warning.textContent = message ?? "";
    warning.hidden = message === null;
  }

  render(preferences);

  new Sortable(list, {
    animation: 150,
    ghostClass: "blk-source--dragging",
    forceFallback: true,
    handle: ".blk-source__handle",
    filter: ".blk-toggle",
    preventOnFilter: false,
    onEnd: event => {
      const { oldIndex, newIndex } = event;
      if (oldIndex === undefined || newIndex === undefined) return;
      commit(moveSource(preferences, oldIndex, newIndex));
    },
  });

  element.append(heading, list, warning);
  return { element, render };
}

function createReadoutRow(labelText: string): { row: HTMLElement; value: HTMLElement } {
  const row = createElement("div", "blk-cache__row");
  const label = createElement("span", "blk-cache__label");
  label.textContent = labelText;
  const dots = createElement("span", "blk-cache__dots");
  dots.setAttribute("aria-hidden", "true");
  const value = createElement("span", "blk-cache__value");
  value.textContent = "…";
  row.append(label, dots, value);
  return { row, value };
}

function createCacheReadout(): CacheReadout {
  const element = createElement("div", "blk-cache");

  const head = createElement("div", "blk-cache__head");
  const title = createElement("span", "blk-cache__title");
  title.textContent = "On this machine";
  head.append(title);

  const stems = createReadoutRow("Cached vocals");
  const model = createReadoutRow("Separation model");
  element.append(head, stems.row, model.row);

  return {
    element,
    setStems(text) {
      stems.value.textContent = text;
    },
    setModel(text) {
      model.value.textContent = text;
    },
  };
}

// -- Clear row -----------------------------------------------------------------

interface ClearRow {
  row: HTMLElement;
  setHint(value: string): void;
  setDisabled(disabled: boolean): void;
}

function createClearRow(labelText: string, hintText: string, onClear: () => void): ClearRow {
  const row = createElement("div", "blk-row");
  const { text, hint } = createTextRow(labelText, hintText);

  const clearButton = createElement("button", "blk-button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.setAttribute("aria-label", `Clear ${labelText.toLowerCase()}`);
  clearButton.disabled = true;
  clearButton.addEventListener("click", onClear);

  row.append(text, clearButton);
  return {
    row,
    setHint(value) {
      hint.textContent = value;
    },
    setDisabled(disabled) {
      clearButton.disabled = disabled;
    },
  };
}

// -- About ---------------------------------------------------------------------

function aboutLink(href: string, text: string): HTMLAnchorElement {
  const link = createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

function createAboutSection(heading: string, build: (body: HTMLElement) => void): HTMLElement {
  const section = createElement("div", "blk-about__section");
  const title = createElement("h3", "blk-about__heading");
  title.textContent = heading;
  const body = createElement("p", "blk-about__body");
  build(body);
  section.append(title, body);
  return section;
}

function createAboutPanel(): HTMLElement {
  const panel = createElement("div", "blk-panel");

  const hero = createElement("div", "blk-about__hero");
  const mark = createElement("img", "blk-about__mark");
  mark.src = tacetIconUrl;
  mark.alt = "";
  mark.width = 52;
  mark.height = 52;
  const heroText = createElement("div", "blk-about__hero-text");
  const name = createElement("h2", "blk-about__name");
  name.textContent = "Tacet";
  const tagline = createElement("p", "blk-about__tagline");
  tagline.textContent = "Playback controls, on your own machine.";
  heroText.append(name, tagline);
  hero.append(mark, heroText);

  const community = createElement("div", "blk-about__section");
  const communityHeading = createElement("h3", "blk-about__heading");
  communityHeading.textContent = "Community";
  const communityList = createElement("ul", "blk-about__body blk-about__list");
  const discordItem = createElement("li");
  discordItem.append(aboutLink(DISCORD_URL, "Discord"), " for questions and chat.");
  const issueItem = createElement("li");
  issueItem.append(aboutLink(ISSUES_URL, "File an issue"), " if something is broken.");
  communityList.append(discordItem, issueItem);
  community.append(communityHeading, communityList);

  panel.append(
    hero,
    createAboutSection("What it is", body => {
      body.textContent =
        "Tacet sits inside YouTube Music and adds the controls the player does not have. Today that means a slider that lifts the voice out of a track, and a crossfade that stops songs ending cold. More will follow.";
    }),
    createAboutSection("Sing-along", body => {
      body.textContent =
        "It runs from the song as recorded down to the instrumental on its own. All the way down is karaoke. Anywhere in between is a guide vocal.";
    }),
    createAboutSection("Crossfade", body => {
      body.textContent =
        "One track blends into the next instead of stopping dead. It does not wait on separation: with no stems to fade out of, the fade runs on the original audio. Set the length under General, or turn it off there.";
    }),
    createAboutSection("Where the separation happens", body => {
      body.textContent =
        "On your own GPU, in your own browser, and nowhere else. The track is captured as it plays, cut into short segments, and run through htdemucs on WebGPU. No audio ever leaves the machine.";
    }),
    createAboutSection("The first track is the slow one", body => {
      body.textContent =
        "The model downloads once and is kept. Separated tracks are kept too, so hearing one again starts instantly. Both live under Storage, along with a budget and a way to clear them.";
    }),

    createAboutSection("Better Lyrics", body => {
      body.append(
        "Optional, but the two are built to sit together: with it installed the sing-along button docks into the lyrics controls instead of the player bar. ",
        aboutLink(BETTER_LYRICS_URL, "Install Better Lyrics"),
        "."
      );
    }),
    createAboutSection("Open source", body => {
      body.append(
        "AGPL v3. Source on ",
        aboutLink(REPOSITORY_URL, "GitHub"),
        ". PRs welcome if you spot something to fix."
      );
    }),
    community,
    createAboutSection("Made by", body => {
      body.append(
        aboutLink(AUTHOR_URL, "Boidu"),
        ", with thanks to everyone in the Better Lyrics community who has tested it and reported bugs."
      );
    })
  );
  return panel;
}

// -- Playing, and coming up ------------------------------------------------------

const STATUS_POLL_MS = 1000;

const NOW_ART_PX = 34;
const NEXT_ART_PX = 20;
const NEXT_GLYPH_PX = 14;

type StatusTrack = NonNullable<TrackStatusMessage["now"]>;
type TrackStatus = Pick<TrackStatusMessage, "now" | "next" | "separation" | "deliveredBy">;

interface ArtworkThumb {
  element: HTMLElement;
  render(url: string | null): void;
}

function createArtworkThumb(sizePx: number): ArtworkThumb {
  const element = createElement("span", "blk-status__thumb");
  let shown: string | null = null;

  return {
    element,
    render(url) {
      if (url === shown) return;
      shown = url;
      if (url === null) {
        element.replaceChildren();
        return;
      }
      const image = createElement("img", "blk-status__art");
      image.alt = "";
      image.addEventListener("load", () => image.classList.add("blk-status__art--ready"), { once: true });
      image.src = sizedArtworkUrl(url, sizePx);
      element.replaceChildren(image);
    },
  };
}

interface Roll {
  element: HTMLElement;
  render(text: string): void;
}

function createRoll(): Roll {
  const element = createElement("span", "blk-roll");
  let shown: string | null = null;

  return {
    element,
    render(text) {
      if (text === shown) return;
      shown = text;

      const previous = element.querySelector(`.blk-roll__line:not(.blk-roll__line--leaving)`);
      if (previous) {
        previous.classList.remove("blk-roll__line--entering");
        previous.classList.add("blk-roll__line--leaving");
        previous.addEventListener("animationend", () => previous.remove(), { once: true });
      }
      if (text === "") return;

      const line = createElement("span", "blk-roll__line blk-roll__line--entering");
      line.textContent = text;
      line.addEventListener("animationend", () => line.classList.remove("blk-roll__line--entering"), { once: true });
      element.append(line);
    },
  };
}

interface StatusRow {
  element: HTMLElement;
  artwork: ArtworkThumb;
  title: HTMLElement;
  roll: Roll;
  replay(): void;
}

function createStatusRow(modifier: string, artPx: number): StatusRow {
  const element = createElement("div", `blk-status__row blk-status__row--${modifier}`);
  const artwork = createArtworkThumb(artPx);
  const title = createElement("span", "blk-status__title");
  const roll = createRoll();

  return {
    element,
    artwork,
    title,
    roll,
    replay() {
      element.classList.remove("blk-status__row--promoted");
      void element.offsetWidth;
      element.classList.add("blk-status__row--promoted");
    },
  };
}

interface StatusSection {
  element: HTMLElement;
  render(status: TrackStatus | null): void;
  setVisible(visible: boolean): void;
}

function nextTrackState(track: StatusTrack): string {
  if (track.cached === null) return "";
  return track.cached ? "Ready" : "Queued";
}

function createStatusSection(): StatusSection {
  const element = createElement("div", "blk-status");
  element.hidden = true;

  const now = createStatusRow("now", NOW_ART_PX);
  const fill = createElement("span", "blk-status__fill");
  const nowText = createElement("span", "blk-status__text");
  const nowArtist = createElement("span", "blk-status__artist");
  nowText.append(now.title, nowArtist);
  now.element.append(fill, now.artwork.element, nowText, now.roll.element);

  const next = createStatusRow("next", NEXT_ART_PX);
  const nextGlyph = createElement("span", "blk-status__glyph");
  nextGlyph.setAttribute("role", "img");
  nextGlyph.setAttribute("aria-label", "Up next");
  nextGlyph.append(createFilledIcon(QUEUE_MARK_PATH, NEXT_GLYPH_PX));
  const nextText = createElement("span", "blk-status__text");
  const nextArtist = createElement("span", "blk-status__artist");
  nextText.append(next.title, nextArtist);
  next.element.append(next.artwork.element, nextGlyph, nextText, next.roll.element);

  element.append(now.element, next.element);

  let shownNowId: string | null = null;
  let shownNextId: string | null = null;
  let visible = true;
  let occupied = false;

  function paint(): void {
    element.hidden = !visible || !occupied;
  }

  function renderRow(row: StatusRow, track: StatusTrack | null, state: string): void {
    row.element.hidden = track === null;
    if (track === null) {
      row.artwork.render(null);
      row.roll.render("");
      return;
    }
    row.title.textContent = track.title ?? "Unknown track";
    row.roll.render(state);
    row.artwork.render(track.artworkUrl);
  }

  return {
    element,
    render(status) {
      occupied = status !== null && (status.now !== null || status.next !== null);
      paint();
      if (status === null || !occupied) {
        shownNowId = null;
        shownNextId = null;
        return;
      }

      const advanced = status.now !== null && status.now.videoId !== shownNowId && status.now.videoId === shownNextId;

      renderRow(now, status.now, separationText(status.separation));
      nowArtist.textContent = describeNowArtist(status.now?.artist ?? "", status.deliveredBy ?? null);
      fill.style.width = `${(separationFill(status.separation) * 100).toFixed(2)}%`;

      renderRow(next, status.next, status.next === null ? "" : nextTrackState(status.next));
      nextArtist.textContent = status.next?.artist ?? "";

      if (advanced) {
        now.replay();
        next.replay();
      }
      shownNowId = status.now?.videoId ?? null;
      shownNextId = status.next?.videoId ?? null;
    },
    setVisible(next) {
      visible = next;
      paint();
    },
  };
}

async function readTrackStatus(): Promise<TrackStatus | null> {
  const command: GetTrackStatusCommand = { type: "blk-get-track-status" };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, command);
    if (!isTrackStatusMessage(response)) {
      console.error(`${LOG_PREFIX} unexpected track status reply`, response);
      return null;
    }
    return response;
  } catch (error) {
    console.debug(`${LOG_PREFIX} no YouTube Music tab answered the track status probe`, error);
    return null;
  }
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const root = createElement("div", "blk-popup");

  const header = createHeader();

  const tabs = createElement("div", "blk-tabs");
  tabs.setAttribute("role", "tablist");

  const scroll = createElement("div", "blk-scroll");

  const footer = createElement("div", "blk-footer");
  const aboutButton = createElement("button", "blk-text-button");
  aboutButton.type = "button";
  aboutButton.append(createInfoIcon(), document.createTextNode("About"));
  const spacer = createElement("span", "blk-footer__spacer");
  const status = createElement("span", "blk-footer__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  footer.append(aboutButton, spacer, status);

  function showStatus(message: string): void {
    status.textContent = message;
  }

  const settings = await loadSettingsFrom(chrome.storage.sync).catch(error => {
    console.error(`${LOG_PREFIX} failed to load settings`, error);
    showStatus("Could not load settings.");
    return DEFAULT_SETTINGS;
  });

  const singAlongToggle = createToggle(
    "Sing-along",
    "Sing-along and everything behind it, crossfade included. Reload YouTube Music after changing this.",
    settings.singAlongEnabled,
    next => {
      saveSettingsFrom(chrome.storage.sync, { singAlongEnabled: next }).catch(error => {
        console.error(`${LOG_PREFIX} failed to save the sing-along setting`, error);
        showStatus("Could not save that change.");
        singAlongToggle.setChecked(!next);
      });
    }
  );

  const autoSeparateToggle = createToggle(
    "Start separating automatically",
    "Begin separation as soon as a track is captured, instead of waiting for a tap.",
    settings.autoSeparateEnabled,
    next => {
      saveSettingsFrom(chrome.storage.sync, { autoSeparateEnabled: next }).catch(error => {
        console.error(`${LOG_PREFIX} failed to save the auto-separate setting`, error);
        showStatus("Could not save that change.");
        autoSeparateToggle.setChecked(!next);
      });
    }
  );

  const debugLoggingToggle = createToggle(
    "Console logging",
    "Print what the extension is doing to the console. Off unless you are debugging.",
    settings.debugLoggingEnabled,
    next => {
      saveSettingsFrom(chrome.storage.sync, { debugLoggingEnabled: next }).catch(error => {
        console.error(`${LOG_PREFIX} failed to save the logging setting`, error);
        showStatus("Could not save that change.");
        debugLoggingToggle.setChecked(!next);
      });
    }
  );

  const modelVariantRow = createModelVariantRow(settings.modelVariant, next => {
    saveSettingsFrom(chrome.storage.sync, { modelVariant: next })
      .then(() => refreshCacheStatus())
      .catch(error => {
        console.error(`${LOG_PREFIX} failed to save the model precision`, error);
        showStatus("Could not save that change.");
        modelVariantRow.setValue(settings.modelVariant);
      });
  });

  const faderPlacementRow = createFaderPlacementRow(settings.faderPlacement, next => {
    saveSettingsFrom(chrome.storage.sync, { faderPlacement: next }).catch(error => {
      console.error(`${LOG_PREFIX} failed to save the fader position`, error);
      showStatus("Could not save that change.");
      faderPlacementRow.setValue(settings.faderPlacement);
    });
  });
  faderPlacementRow.row.hidden = true;
  probeBetterLyrics().then(present => {
    faderPlacementRow.row.hidden = !present;
  });

  const crossfadeRow = createCrossfadeRow(CROSSFADE_PRESETS_SECONDS, settings.crossfadeSeconds, next => {
    saveSettingsFrom(chrome.storage.sync, { crossfadeSeconds: next }).catch(error => {
      console.error(`${LOG_PREFIX} failed to save the crossfade length`, error);
      showStatus("Could not save that change.");
      crossfadeRow.setValue(settings.crossfadeSeconds);
    });
  });

  const budgetSlider = createBudgetSlider(CACHE_BUDGET_PRESETS_BYTES, settings.cacheBudgetBytes, bytes => {
    saveSettingsFrom(chrome.storage.sync, { cacheBudgetBytes: bytes })
      .then(() => refreshCacheStatus())
      .catch(error => {
        console.error(`${LOG_PREFIX} failed to save the cache budget`, error);
        showStatus("Could not save that change.");
      });
  });

  const cacheReadout = createCacheReadout();
  const stemClearRow = createClearRow("Cached vocals", "Cleared tracks separate again from scratch.", () => {
    clearStemCache();
  });
  const modelClearRow = createClearRow("Separation model", "Downloads again the next time a track needs it.", () => {
    clearModelCache();
  });

  const generalPanel = createElement("div", "blk-panel");
  generalPanel.setAttribute("role", "tabpanel");
  generalPanel.append(singAlongToggle.row, crossfadeRow.row, faderPlacementRow.row, debugLoggingToggle.row);

  const separationPanel = createElement("div", "blk-panel");
  separationPanel.setAttribute("role", "tabpanel");
  separationPanel.append(autoSeparateToggle.row, modelVariantRow.row);

  const sourcesPanel = createSourcesPanel(settings.sources, next => {
    saveSettingsFrom(chrome.storage.sync, { sources: next }).catch(error => {
      console.error(`${LOG_PREFIX} failed to save the source order`, error);
      showStatus("Could not save that.");
      sourcesPanel.render(settings.sources);
    });
  });

  const storagePanel = createElement("div", "blk-panel");
  storagePanel.setAttribute("role", "tabpanel");
  storagePanel.append(budgetSlider.row, cacheReadout.element, stemClearRow.row, modelClearRow.row);

  const panels: Record<PopupTab | "about", HTMLElement> = {
    general: generalPanel,
    separation: separationPanel,
    sources: sourcesPanel.element,
    storage: storagePanel,
    about: createAboutPanel(),
  };

  const TAB_LABELS: Record<PopupTab, string> = {
    general: "General",
    separation: "Separation",
    sources: "Sources",
    storage: "Storage",
  };

  let view: PopupView = initialView();

  const tabButtons = POPUP_TABS.map(tab => {
    const button = createElement("button", "blk-tab");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.textContent = TAB_LABELS[tab];
    button.addEventListener("click", () => {
      view = selectTab(view, tab);
      render();
    });
    tabs.append(button);
    return { tab, button };
  });

  aboutButton.addEventListener("click", () => {
    view = toggleAbout(view);
    render();
  });

  const statusSection = createStatusSection();

  function render(): void {
    tabs.hidden = !isTabBarVisible(view);
    statusSection.setVisible(isStatusVisible(view));
    for (const { tab, button } of tabButtons) {
      button.setAttribute("aria-selected", String(!view.aboutOpen && view.tab === tab));
    }
    aboutButton.setAttribute("aria-pressed", String(view.aboutOpen));
    scroll.replaceChildren(panels[activePanel(view)]);
    scroll.scrollTop = 0;
  }

  root.append(header, statusSection.element, tabs, scroll, footer);
  document.body.append(root);
  render();

  function refreshStatus(): void {
    readTrackStatus()
      .then(status => statusSection.render(status))
      .catch(error => console.error(`${LOG_PREFIX} failed to read the track status`, error));
  }
  refreshStatus();
  setInterval(refreshStatus, STATUS_POLL_MS);

  async function refreshCacheStatus(): Promise<void> {
    const command: GetCacheStatusCommand = { type: "blk-get-cache-status" };
    try {
      const response = await chrome.runtime.sendMessage(command);
      if (!isCacheStatusMessage(response)) throw new Error("unexpected response shape");

      cacheReadout.setStems(formatBytes(response.stemCacheBytes));
      cacheReadout.setModel(response.modelCached ? formatBytes(response.modelCacheBytes) : "none");

      stemClearRow.setHint(
        response.stemCacheBytes === 0
          ? "Nothing cached yet."
          : `Frees ${formatBytes(response.stemCacheBytes)}. Cleared tracks separate again from scratch.`
      );
      stemClearRow.setDisabled(response.stemCacheBytes === 0);

      modelClearRow.setHint(
        response.modelCached
          ? "Downloads again the next time a track needs it."
          : "Not downloaded yet, so there is nothing to clear."
      );
      modelClearRow.setDisabled(!response.modelCached);
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to read cache status`, error);
      cacheReadout.setStems("unreadable");
      cacheReadout.setModel("unreadable");
      showStatus("Could not read cache size.");
    }
  }

  async function clearStemCache(): Promise<void> {
    stemClearRow.setDisabled(true);
    const command: ClearStemCacheCommand = { type: "blk-clear-stem-cache" };
    try {
      const response = await chrome.runtime.sendMessage(command);
      if (!isClearCacheResultMessage(response) || !response.ok) {
        throw new Error(
          isClearCacheResultMessage(response) ? response.reason ?? "clear failed" : "unexpected response shape"
        );
      }
      showStatus("Cached vocals cleared.");
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to clear the stem cache`, error);
      showStatus("Could not clear the vocal cache.");
    } finally {
      await refreshCacheStatus();
    }
  }

  async function clearModelCache(): Promise<void> {
    modelClearRow.setDisabled(true);
    const command: ClearModelCacheCommand = { type: "blk-clear-model-cache" };
    try {
      const response = await chrome.runtime.sendMessage(command);
      if (!isClearCacheResultMessage(response) || !response.ok) {
        throw new Error(
          isClearCacheResultMessage(response) ? response.reason ?? "clear failed" : "unexpected response shape"
        );
      }
      showStatus("Separation model cleared.");
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to clear the separation model`, error);
      showStatus("Could not clear the separation model.");
    } finally {
      await refreshCacheStatus();
    }
  }

  await refreshCacheStatus();
}

main().catch(error => {
  console.error(`${LOG_PREFIX} failed to initialize the popup`, error);
});
