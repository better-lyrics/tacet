const QUEUE_ITEM_SELECTOR = "ytmusic-player-queue-item";
const SELECTED_ATTRIBUTE = "selected";

interface QueueItem {
  videoId: string | null;
  selected: boolean;
  title?: string | null;
  artist?: string | null;
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

interface QueueItemData {
  videoId?: unknown;
  navigationEndpoint?: { watchEndpoint?: { videoId?: unknown } };
  title?: TextRuns;
  shortBylineText?: TextRuns;
  longBylineText?: TextRuns;
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

// Polymer renders these as run lists rather than plain strings, and an item
// scrolled out of view can carry an empty one, so a missing name is null
// rather than an empty string the band would render as a gap.
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
    // The byline is "Artist • Album • Year" on some rows, so only the first
    // run is the artist.
    artist: readRuns(own?.shortBylineText, polymer?.shortBylineText, own?.longBylineText, polymer?.longBylineText),
  };
}

function readQueueItems(doc: Document): QueueItem[] {
  return Array.from(doc.querySelectorAll<PolymerQueueItem>(QUEUE_ITEM_SELECTOR)).map(element => ({
    videoId: readQueueItemVideoId(element),
    selected: element.hasAttribute(SELECTED_ATTRIBUTE),
    ...readQueueItemText(element),
  }));
}

interface NextTrack {
  videoId: string;
  title: string | null;
  artist: string | null;
}

function nextTrackInQueue(items: readonly QueueItem[], currentVideoId: string | null): NextTrack | null {
  const videoId = nextVideoIdInQueue(items, currentVideoId);
  if (videoId === null) return null;
  const item = items.find(candidate => candidate.videoId === videoId);
  return { videoId, title: item?.title ?? null, artist: item?.artist ?? null };
}

export { nextVideoIdInQueue, nextTrackInQueue, readQueueItems, QUEUE_ITEM_SELECTOR, SELECTED_ATTRIBUTE };
export type { QueueItem, NextTrack };
