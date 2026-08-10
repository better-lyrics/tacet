import "./popup.css";
import betterLyricsIconUrl from "data-base64:../assets/brand/better-lyrics.png";
import { type ModelVariant, getModelDescriptor } from "@/cache/model-url";
import { formatBytes } from "@/settings/format-bytes";
import { extensionVersion } from "@/shared/version";
import { createSelect } from "@/settings/select";
import { CACHE_BUDGET_PRESETS_BYTES, DEFAULT_SETTINGS } from "@/settings/settings";
import { loadSettingsFrom, saveSettingsFrom } from "@/settings/storage";
import {
  type ClearModelCacheCommand,
  type ClearStemCacheCommand,
  type GetCacheStatusCommand,
  isCacheStatusMessage,
  isClearCacheResultMessage,
} from "../workers/protocol2";

// -- Popup: settings and cache management --------------------------------------
//
// Plain HTML/TS popup (Plasmo auto-detects src/popup.ts as the popup entry
// and, since it is not a .tsx/.vue/.svelte file, ships it without a UI
// framework). Preferences round-trip through chrome.storage.sync via
// src/settings/storage.ts; cache byte totals and clears are read live from
// IndexedDB by routing through src/background.ts to the offscreen document,
// which is the only place that holds the connection (see workers/offscreen.ts).

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

// -- Header links ---------------------------------------------------------------

const BETTER_LYRICS_URL = "https://betterlyrics.org";
const REPOSITORY_URL = "https://github.com/better-lyrics/tacet";

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

function createExternalLink(href: string, label: string, className: string): HTMLAnchorElement {
  const link = createElement("a", className);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = label;
  link.setAttribute("aria-label", label);
  return link;
}

function createGithubIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", GITHUB_MARK_PATH);
  svg.append(path);
  return svg;
}

function createHeader(): HTMLElement {
  const header = createElement("div", "blk-popup__header");

  const brand = createExternalLink(BETTER_LYRICS_URL, "Better Lyrics", "blk-popup__brand");
  const brandIcon = createElement("img", "blk-popup__brand-icon");
  brandIcon.src = betterLyricsIconUrl;
  brandIcon.alt = "";
  brandIcon.width = 18;
  brandIcon.height = 18;
  brand.append(brandIcon);

  const title = createElement("span", "blk-popup__title");
  title.textContent = "Tacet";
  const version = createElement("span", "blk-popup__version");
  version.textContent = extensionVersion();
  title.append(version);

  const repository = createExternalLink(REPOSITORY_URL, "View source on GitHub", "blk-popup__icon-button");
  repository.append(createGithubIcon());

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

interface BudgetSlider {
  row: HTMLElement;
}

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
): BudgetSlider {
  const row = createElement("div", "blk-row blk-row--stack");
  const { text, hint, labelId } = createTextRow("Cache budget", "");
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
  value.textContent = formatBytes(presets[Number(slider.value)]);

  slider.addEventListener("input", () => {
    value.textContent = formatBytes(presets[Number(slider.value)]);
  });

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

// -- Cache row (readout + clear button) ----------------------------------------

interface CacheRow {
  row: HTMLElement;
  setReadout(value: string): void;
  setClearDisabled(disabled: boolean): void;
}

function createCacheRow(labelText: string, onClear: () => void): CacheRow {
  const row = createElement("div", "blk-row");
  const { text, hint } = createTextRow(labelText, "Loading…");

  const clearButton = createElement("button", "blk-button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.setAttribute("aria-label", `Clear ${labelText.toLowerCase()}`);
  clearButton.disabled = true;
  clearButton.addEventListener("click", onClear);

  row.append(text, clearButton);
  return {
    row,
    setReadout(valueText) {
      hint.textContent = valueText;
    },
    setClearDisabled(disabled) {
      clearButton.disabled = disabled;
    },
  };
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const root = createElement("div", "blk-popup");

  const header = createHeader();

  const status = createElement("div", "blk-popup__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

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
    "Master switch. Reload YouTube Music after changing this.",
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

  const modelVariantRow = createModelVariantRow(settings.modelVariant, next => {
    saveSettingsFrom(chrome.storage.sync, { modelVariant: next })
      .then(() => refreshCacheStatus())
      .catch(error => {
        console.error(`${LOG_PREFIX} failed to save the model precision`, error);
        showStatus("Could not save that change.");
        modelVariantRow.setValue(settings.modelVariant);
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

  const stemRow = createCacheRow("Cached vocals", () => {
    clearStemCache();
  });
  const modelRow = createCacheRow("Separation model", () => {
    clearModelCache();
  });

  root.append(
    header,
    singAlongToggle.row,
    autoSeparateToggle.row,
    modelVariantRow.row,
    budgetSlider.row,
    stemRow.row,
    modelRow.row,
    status
  );
  document.body.append(root);

  async function refreshCacheStatus(): Promise<void> {
    const command: GetCacheStatusCommand = { type: "blk-get-cache-status" };
    try {
      const response = await chrome.runtime.sendMessage(command);
      if (!isCacheStatusMessage(response)) throw new Error("unexpected response shape");

      stemRow.setReadout(`${formatBytes(response.stemCacheBytes)} used`);
      stemRow.setClearDisabled(response.stemCacheBytes === 0);

      modelRow.setReadout(
        response.modelCached ? `Downloaded (${formatBytes(response.modelCacheBytes)})` : "Not downloaded"
      );
      modelRow.setClearDisabled(!response.modelCached);
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to read cache status`, error);
      stemRow.setReadout("Could not read cache size.");
      modelRow.setReadout("Could not read cache size.");
    }
  }

  async function clearStemCache(): Promise<void> {
    stemRow.setClearDisabled(true);
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
    modelRow.setClearDisabled(true);
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
      console.error(`${LOG_PREFIX} failed to clear the model cache`, error);
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
