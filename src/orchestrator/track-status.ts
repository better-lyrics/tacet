// -- What the popup's status section shows -------------------------------------

interface StatusTrack {
  videoId: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  cached: boolean | null;
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

    clear() {
      current = EMPTY;
    },
  };
}

export { createTrackStatusStore };
export type { QueueTracks, StatusTrack, TrackNames, TrackStatusStore };
