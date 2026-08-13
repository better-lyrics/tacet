const QUEUE_ITEM_SELECTOR = "ytmusic-player-queue-item";
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
  return Array.from(doc.querySelectorAll<PolymerQueueItem>(QUEUE_ITEM_SELECTOR)).map(element => ({
    videoId: readQueueItemVideoId(element),
    selected: element.hasAttribute(SELECTED_ATTRIBUTE),
    playState: element.getAttribute(PLAY_STATE_ATTRIBUTE),
    artworkUrl: readQueueItemArtwork(element),
    ...readQueueItemText(element),
  }));
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

// Which row the listener is on, asked of the queue itself rather than of any id.
//
// `selected` is not that answer. Measured on a real radio queue of 71 rows, two
// carried it: index 1, three tracks stale, and index 4, the track actually
// playing. Taking the first named a track the listener had already heard as the
// one coming next, which staged the wrong track, crossfaded into a previous song,
// and then aborted the fade because the player landed somewhere else entirely.
//
// `play-button-state` is that answer. It read `playing` on exactly one row, the
// right one, while every other row read `default`. It is a statement about what
// is playing rather than a label somebody attached to a row, which is the same
// reason the player bar beats a videoId everywhere else in this codebase. The id
// is the last resort precisely because it is the least trustworthy input here.
function currentIndexInQueue(items: readonly QueueItem[], currentVideoId: string | null): number {
  const playing = items.findIndex(
    item => typeof item.playState === "string" && item.playState !== "" && item.playState !== IDLE_PLAY_STATE
  );
  if (playing !== -1) return playing;

  const selected = items.map((item, index) => (item.selected ? index : -1)).filter(index => index !== -1);
  if (selected.length === 1) return selected[0];

  if (currentVideoId) {
    const match = items.findIndex(item => item.videoId === currentVideoId);
    if (match !== -1) return match;
  }

  // Several rows claim the selection and nothing else can break the tie. The
  // stale ones sit above the live one, so the last is the least wrong.
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
  readQueueItems,
  IDLE_PLAY_STATE,
  PLAY_STATE_ATTRIBUTE,
  QUEUE_ITEM_SELECTOR,
  SELECTED_ATTRIBUTE,
};
export type { QueueItem, QueueTrack };
