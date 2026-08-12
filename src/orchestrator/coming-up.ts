// -- What the popup shows in its Coming up band --------------------------------
//
// One owner, because three places contribute to the same record and none of
// them knows the whole of it: the page world names the track and resolves its
// artwork, and the pipeline learns from a cache probe whether it is already
// separated. Each field keeps its last known value, so a partial update never
// blanks the band.

interface ComingUpTrack {
  videoId: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  cached: boolean | null;
}

interface ComingUpStore {
  get(): ComingUpTrack | null;
  setTrack(track: { videoId: string; title: string | null; artist: string | null }): void;
  setArtwork(videoId: string, artworkUrl: string): void;
  setCached(videoId: string, cached: boolean): void;
  clear(): void;
}

function createComingUpStore(): ComingUpStore {
  let current: ComingUpTrack | null = null;

  return {
    get: () => current,

    setTrack(track) {
      // The same track arriving again is a refresh, so anything already
      // learned about it survives.
      current =
        current?.videoId === track.videoId
          ? { ...current, title: track.title ?? current.title, artist: track.artist ?? current.artist }
          : { ...track, artworkUrl: null, cached: null };
    },

    // Both of these arrive later and out of band, so a late answer for a track
    // that has already been replaced is dropped rather than applied to the
    // wrong one.
    setArtwork(videoId, artworkUrl) {
      if (current?.videoId !== videoId) return;
      current = { ...current, artworkUrl };
    },

    setCached(videoId, cached) {
      if (current?.videoId !== videoId) return;
      current = { ...current, cached };
    },

    clear() {
      current = null;
    },
  };
}

export { createComingUpStore };
export type { ComingUpStore, ComingUpTrack };
