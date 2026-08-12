// -- What the popup's status section shows -------------------------------------
//
// One owner, because three places contribute to the same two records and none
// of them knows the whole of it: the page world names the tracks and carries
// their square artwork, the ytimg fallback resolves later and out of band, and
// the pipeline learns from a cache probe whether a track is already separated.
// Each field keeps its last known value, so a partial update never blanks a row.
//
// A track keeps what is already known about it when it moves between the two
// slots, which is what lets a queue advance promote the next row into the
// playing row without its artwork flickering away and loading again.

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
