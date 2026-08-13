const QUEUE_ITEM_SELECTOR = "ytmusic-player-queue-item";
const COUNTERPART_SELECTOR = "#counterpart-renderer";
const WRAPPER_SELECTOR = "ytmusic-playlist-panel-video-wrapper-renderer";
const SELECTED_ATTRIBUTE = "selected";
const PLAY_STATE_ATTRIBUTE = "play-button-state";
const IDLE_PLAY_STATE = "default";

interface QueueItem {
  videoId: string | null;
  selected: boolean;
  playState?: string | null;
  title?: string | null;
  artist?: string | null;
  artworkUrl?: string | null;
  wrapper?: number | null;
  counterpart?: boolean;
}

// -- One row per track, not one per rendering ----------------------------------

function isPlayingRow(item: QueueItem): boolean {
  return typeof item.playState === "string" && item.playState !== "" && item.playState !== IDLE_PLAY_STATE;
}

function dropSpareCounterparts(items: readonly QueueItem[]): QueueItem[] {
  const chosen = new Map<number, QueueItem>();
  for (const item of items) {
    if (typeof item.wrapper !== "number") continue;
    const held = chosen.get(item.wrapper);
    if (held !== undefined && isPlayingRow(held)) continue;
    if (held === undefined || isPlayingRow(item) || (item.counterpart !== true && held.counterpart === true)) {
      chosen.set(item.wrapper, item);
    }
  }
  return items.filter(item => typeof item.wrapper !== "number" || chosen.get(item.wrapper) === item);
}

function nextVideoIdInQueue(items: readonly QueueItem[], currentVideoId: string | null): string | null {
  if (items.length === 0) return null;

  const currentIndex = currentIndexInQueue(items, currentVideoId);
  if (currentIndex === -1 || currentIndex >= items.length - 1) return null;

  const next = items[currentIndex + 1].videoId;
  if (!next || next === currentVideoId) return null;
  return next;
}

interface TextRuns {
  runs?: { text?: unknown }[];
}

interface Thumbnail {
  url?: unknown;
  width?: unknown;
}

interface QueueItemData {
  videoId?: unknown;
  navigationEndpoint?: { watchEndpoint?: { videoId?: unknown } };
  title?: TextRuns;
  shortBylineText?: TextRuns;
  longBylineText?: TextRuns;
  thumbnail?: { thumbnails?: Thumbnail[] };
}

interface PolymerQueueItem extends Element {
  data?: QueueItemData;
  __data?: { data?: QueueItemData };
}

function firstVideoId(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function readQueueItemVideoId(element: PolymerQueueItem): string | null {
  const own = element.data;
  const polymer = element.__data?.data;
  return firstVideoId(
    own?.videoId,
    own?.navigationEndpoint?.watchEndpoint?.videoId,
    polymer?.videoId,
    polymer?.navigationEndpoint?.watchEndpoint?.videoId
  );
}

function readRuns(...candidates: (TextRuns | undefined)[]): string | null {
  for (const candidate of candidates) {
    const text = candidate?.runs
      ?.map(run => (typeof run.text === "string" ? run.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return null;
}

function readQueueItemText(element: PolymerQueueItem): { title: string | null; artist: string | null } {
  const own = element.data;
  const polymer = element.__data?.data;
  return {
    title: readRuns(own?.title, polymer?.title),
    artist: readRuns(own?.shortBylineText, polymer?.shortBylineText, own?.longBylineText, polymer?.longBylineText),
  };
}

// -- Square album art ----------------------------------------------------------

function widestThumbnailUrl(thumbnails: Thumbnail[] | undefined): string | null {
  if (!Array.isArray(thumbnails)) return null;
  let best: string | null = null;
  let bestWidth = -1;
  for (const thumbnail of thumbnails) {
    if (typeof thumbnail?.url !== "string" || thumbnail.url.length === 0) continue;
    const width = typeof thumbnail.width === "number" ? thumbnail.width : 0;
    if (width >= bestWidth) {
      bestWidth = width;
      best = thumbnail.url;
    }
  }
  return best;
}

function readQueueItemArtwork(element: PolymerQueueItem): string | null {
  return (
    widestThumbnailUrl(element.data?.thumbnail?.thumbnails) ??
    widestThumbnailUrl(element.__data?.data?.thumbnail?.thumbnails)
  );
}

function readQueueItems(doc: Document): QueueItem[] {
  const wrappers = Array.from(doc.querySelectorAll(WRAPPER_SELECTOR));
  return dropSpareCounterparts(
    Array.from(doc.querySelectorAll<PolymerQueueItem>(QUEUE_ITEM_SELECTOR)).map(element => {
      const wrapper = element.closest(WRAPPER_SELECTOR);
      return {
        videoId: readQueueItemVideoId(element),
        selected: element.hasAttribute(SELECTED_ATTRIBUTE),
        playState: element.getAttribute(PLAY_STATE_ATTRIBUTE),
        artworkUrl: readQueueItemArtwork(element),
        wrapper: wrapper === null ? null : wrappers.indexOf(wrapper),
        counterpart: element.closest(COUNTERPART_SELECTOR) !== null,
        ...readQueueItemText(element),
      };
    })
  );
}

interface QueueTrack {
  videoId: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
}

function describeQueueItem(item: QueueItem | undefined, videoId: string): QueueTrack {
  return {
    videoId,
    title: item?.title ?? null,
    artist: item?.artist ?? null,
    artworkUrl: item?.artworkUrl ?? null,
  };
}

// -- Which row the listener is on ----------------------------------------------

function currentIndexInQueue(items: readonly QueueItem[], currentVideoId: string | null): number {
  const playing = items.findIndex(isPlayingRow);
  if (playing !== -1) return playing;

  const selected = items.map((item, index) => (item.selected ? index : -1)).filter(index => index !== -1);
  if (selected.length === 1) return selected[0];

  if (currentVideoId) {
    const match = items.findIndex(item => item.videoId === currentVideoId);
    if (match !== -1) return match;
  }

  return selected.length > 0 ? selected[selected.length - 1] : -1;
}

function currentTrackInQueue(items: readonly QueueItem[], currentVideoId: string | null): QueueTrack | null {
  const index = currentIndexInQueue(items, currentVideoId);
  if (index === -1) return null;
  const videoId = items[index].videoId;
  if (!videoId) return null;
  return describeQueueItem(items[index], videoId);
}

function nextTrackInQueue(items: readonly QueueItem[], currentVideoId: string | null): QueueTrack | null {
  const videoId = nextVideoIdInQueue(items, currentVideoId);
  if (videoId === null) return null;
  return describeQueueItem(
    items.find(candidate => candidate.videoId === videoId),
    videoId
  );
}

export {
  nextVideoIdInQueue,
  nextTrackInQueue,
  currentTrackInQueue,
  dropSpareCounterparts,
  readQueueItems,
  COUNTERPART_SELECTOR,
  IDLE_PLAY_STATE,
  PLAY_STATE_ATTRIBUTE,
  QUEUE_ITEM_SELECTOR,
  SELECTED_ATTRIBUTE,
  WRAPPER_SELECTOR,
};
export type { QueueItem, QueueTrack };
