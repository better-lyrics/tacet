// -- What the popup's status section shows -------------------------------------

import { advanceAhead } from "@/orchestrator/ahead-status";
import type { AheadActivity } from "@/orchestrator/ahead-status";

interface StatusTrack {
  videoId: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  cached: boolean | null;
  activity: AheadActivity | null;
  fraction: number | null;
}

interface TrackNames {
  videoId: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
}

interface QueueTracks {
  now: StatusTrack | null;
  next: StatusTrack | null;
}

interface TrackStatusStore {
  get(): QueueTracks;
  setTracks(tracks: { now: TrackNames | null; next: TrackNames | null }): void;
  setArtwork(videoId: string, artworkUrl: string): void;
  setCached(videoId: string, cached: boolean): void;
  setActivity(videoId: string, activity: AheadActivity, fraction?: number | null): void;
  clear(): void;
}

const EMPTY: QueueTracks = { now: null, next: null };

function knownTrack(tracks: QueueTracks, videoId: string): StatusTrack | null {
  if (tracks.now?.videoId === videoId) return tracks.now;
  if (tracks.next?.videoId === videoId) return tracks.next;
  return null;
}

function fillSlot(previous: QueueTracks, names: TrackNames | null): StatusTrack | null {
  if (names === null) return null;
  const known = knownTrack(previous, names.videoId);
  return {
    videoId: names.videoId,
    title: names.title ?? known?.title ?? null,
    artist: names.artist ?? known?.artist ?? null,
    artworkUrl: names.artworkUrl ?? known?.artworkUrl ?? null,
    cached: known?.cached ?? null,
    activity: known?.activity ?? null,
    fraction: known?.fraction ?? null,
  };
}

function createTrackStatusStore(): TrackStatusStore {
  let current: QueueTracks = EMPTY;

  function amend(videoId: string, change: Partial<StatusTrack>): void {
    const now = current.now?.videoId === videoId ? { ...current.now, ...change } : current.now;
    const next = current.next?.videoId === videoId ? { ...current.next, ...change } : current.next;
    current = { now, next };
  }

  return {
    get: () => current,

    setTracks(tracks) {
      current = { now: fillSlot(current, tracks.now), next: fillSlot(current, tracks.next) };
    },

    setArtwork(videoId, artworkUrl) {
      amend(videoId, { artworkUrl });
    },

    setCached(videoId, cached) {
      amend(videoId, { cached });
    },

    setActivity(videoId, activity, fraction = null) {
      const held = knownTrack(current, videoId);
      if (held === null) return;
      const next = advanceAhead(held.activity, activity);
      amend(videoId, { activity: next, fraction: next === activity ? fraction : held.fraction });
    },

    clear() {
      current = EMPTY;
    },
  };
}

export { createTrackStatusStore };
export type { QueueTracks, StatusTrack, TrackNames, TrackStatusStore };
