const FALLBACK_ELEMENT_SELECTOR = "video.video-stream.html5-main-video";

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

// The appendBuffer patch is on the prototype, so every MediaSource in the page
// reaches it, including the shadow player's. Measured: a MediaSource created
// with no connection to the listener's player landed in their capture under
// their videoId, and a live shadow left the accumulator holding two streams with
// the byte plan serving 759 bytes of 6.7 MB. An append whose element cannot be
// resolved is still captured, because losing the listener's own capture is worse
// than the pollution this refuses.
function capturesFrom(element: MediaElementCandidate | null): boolean {
  return element === null || !element.matches(SHADOW_ELEMENT_SELECTOR);
}

export { FALLBACK_ELEMENT_SELECTOR, SHADOW_ELEMENT_SELECTOR, capturesFrom, selectPlaybackElement };
export type { MediaElementCandidate };
