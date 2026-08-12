import "./popup.css";
import tacetIconUrl from "data-base64:../assets/brand/logo.png";
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
  isTabBarVisible,
  selectTab,
  toggleAbout,
} from "@/settings/popup-tabs";
import { createSelect } from "@/settings/select";
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

function createExternalLink(href: string, label: string, className: string): HTMLAnchorElement {
  const link = createElement("a", className);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = label;
  link.setAttribute("aria-label", label);
  return link;
}

function createGithubIcon(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", GITHUB_MARK_PATH);
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
  repository.append(createGithubIcon(16));

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
    "Fader position",
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
  const row = createElement("div", "blk-row");
  const { text, labelId } = createTextRow(
    "Crossfade",
    "Blend the end of one separated track into the start of the next. Takes effect immediately, except during a fade already under way."
  );

  const select = createSelect<string>(
    presets.map(seconds =>
      seconds === 0
        ? { value: "0", label: "Off", note: "hard cut" }
        : { value: String(seconds), label: describeCrossfade(seconds) }
    ),
    String(presets[closestPresetIndex(presets, initialSeconds)]),
    value => onChange(Number(value)),
    labelId
  );

  row.append(text, select.element);
  return { row, setValue: value => select.setValue(String(value)) };
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
  tagline.textContent = "Vocals separated on your own machine.";
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
        "Tacet lifts the voice out of whatever is playing on YouTube Music and gives you a fader to set how much of it comes back. All the way down is karaoke. Anywhere in between is a guide vocal.";
    }),
    createAboutSection("Where the work happens", body => {
      body.textContent =
        "On your own GPU, in your own browser, and nowhere else. The track is captured as it plays, cut into short segments, and run through htdemucs on WebGPU. No audio ever leaves the machine.";
    }),
    createAboutSection("The first track is the slow one", body => {
      body.textContent =
        "The model downloads once and is kept. Separated tracks are kept too, so hearing one again starts instantly. Both live under Storage, along with a budget and a way to clear them.";
    }),
    createAboutSection("Better Lyrics", body => {
      body.append(
        "Optional, but the two are built to sit together: with it installed the fader docks into the lyrics controls instead of the player bar. ",
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
//
// Which picture to show is settled in the page world and handed here already
// resolved, the same division better-lyrics-shaders uses: its popup never
// re-derives a URL from the DOM, it displays what the content script gives it.
// What size to ask for is settled here, because only this side knows how big
// the box is. The image is held at zero opacity until it reports a load, and
// the element is replaced whenever the URL changes so a new track fades in
// rather than swapping.

const STATUS_POLL_MS = 1000;

const NOW_ART_PX = 34;
const NEXT_ART_PX = 20;

type StatusTrack = NonNullable<TrackStatusMessage["now"]>;
type TrackStatus = Pick<TrackStatusMessage, "now" | "next" | "separation">;

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

// The fader's hover card roll, verbatim, so the popup and the on-page control
// move the same way. Both lines share one grid cell and cross over rather than
// stacking, which is what stops the row resizing under them.
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
}

// A cache miss on the track coming up is not a verdict, it is the ordinary
// state of a track the pipeline has not reached yet: separation runs one track
// at a time and the next one is only warmed once this one has engaged. Saying
// "not separated" read as a failure and, worse, never changed, because the
// cache probe answers once. It flips to Ready when the ahead separation lands.
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
  const nextLabel = createElement("span", "blk-status__label");
  nextLabel.textContent = "Next";
  const nextText = createElement("span", "blk-status__text");
  nextText.append(next.title);
  next.element.append(next.artwork.element, nextLabel, nextText, next.roll.element);

  element.append(now.element, next.element);

  let shownNowId: string | null = null;
  let shownNextId: string | null = null;

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
      if (status === null || (status.now === null && status.next === null)) {
        element.hidden = true;
        shownNowId = null;
        shownNextId = null;
        return;
      }
      element.hidden = false;

      // A queue advance is the next row becoming the playing one, and only
      // that lifts. A jump to an unrelated track is not an advance.
      const advanced = status.now !== null && status.now.videoId !== shownNowId && status.now.videoId === shownNextId;

      renderRow(now, status.now, separationText(status.separation));
      nowArtist.textContent = status.now?.artist ?? "";
      fill.style.width = `${(separationFill(status.separation) * 100).toFixed(2)}%`;

      renderRow(next, status.next, status.next === null ? "" : nextTrackState(status.next));

      if (advanced) {
        now.replay();
        next.replay();
      }
      shownNowId = status.now?.videoId ?? null;
      shownNextId = status.next?.videoId ?? null;
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

  const storagePanel = createElement("div", "blk-panel");
  storagePanel.setAttribute("role", "tabpanel");
  storagePanel.append(budgetSlider.row, cacheReadout.element, stemClearRow.row, modelClearRow.row);

  const panels: Record<PopupTab | "about", HTMLElement> = {
    general: generalPanel,
    separation: separationPanel,
    storage: storagePanel,
    about: createAboutPanel(),
  };

  const TAB_LABELS: Record<PopupTab, string> = {
    general: "General",
    separation: "Separation",
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

  function render(): void {
    tabs.hidden = !isTabBarVisible(view);
    for (const { tab, button } of tabButtons) {
      button.setAttribute("aria-selected", String(!view.aboutOpen && view.tab === tab));
    }
    aboutButton.setAttribute("aria-pressed", String(view.aboutOpen));
    scroll.replaceChildren(panels[activePanel(view)]);
    scroll.scrollTop = 0;
  }

  const statusSection = createStatusSection();

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
