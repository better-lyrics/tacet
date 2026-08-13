const FALLBACK_ELEMENT_SELECTOR = "video.video-stream.html5-main-video";

// A shadow player is a second, complete player in this same document, and its
// element decodes real bytes. "The one that is decoding" would therefore pick the
// shadow over the listener's own player, which routes the wrong track into the
// graph and leaves the deck following a clock nobody is listening to. Anything
// inside the shadow's host is never the listener's element.
const SHADOW_ELEMENT_SELECTOR = "#blk-shadow-player video, #blk-shadow-player audio";

interface MediaElementCandidate {
  webkitAudioDecodedByteCount?: number;
  matches(selector: string): boolean;
}

function selectPlaybackElement<T extends MediaElementCandidate>(candidates: T[]): T | null {
  const listeners = candidates.filter(candidate => !candidate.matches(SHADOW_ELEMENT_SELECTOR));
  const decoding = listeners.find(candidate => (candidate.webkitAudioDecodedByteCount ?? 0) > 0);
  if (decoding) return decoding;
  return listeners.find(candidate => candidate.matches(FALLBACK_ELEMENT_SELECTOR)) ?? null;
}

export { FALLBACK_ELEMENT_SELECTOR, SHADOW_ELEMENT_SELECTOR, selectPlaybackElement };
export type { MediaElementCandidate };
