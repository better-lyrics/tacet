const QUEUE_ITEM_SELECTOR = "ytmusic-player-queue-item";
const SELECTED_ATTRIBUTE = "selected";

interface QueueItem {
  videoId: string | null;
  selected: boolean;
  title?: string | null;
  artist?: string | null;
  artworkUrl?: string | null;
}

function nextVideoIdInQueue(items: readonly QueueItem[], currentVideoId: string | null): string | null {
  if (items.length === 0) return null;

  let currentIndex = items.findIndex(item => item.selected);
  if (currentIndex === -1 && currentVideoId) {
    currentIndex = items.findIndex(item => item.videoId === currentVideoId);
  }
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
//
// Every queue row carries its own square cover as a googleusercontent ladder
// running 60 to 544. The widest is taken because the size parameter is
// rewritten to the box being drawn anyway, and a wide base is the one that
// still looks right if a future row arrives without one.

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

function currentIndexInQueue(items: readonly QueueItem[], currentVideoId: string | null): number {
  const selected = items.findIndex(item => item.selected);
  if (selected !== -1) return selected;
  if (!currentVideoId) return -1;
  return items.findIndex(item => item.videoId === currentVideoId);
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
  QUEUE_ITEM_SELECTOR,
  SELECTED_ATTRIBUTE,
};
export type { QueueItem, QueueTrack };
