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

export { FALLBACK_ELEMENT_SELECTOR, SHADOW_ELEMENT_SELECTOR, selectPlaybackElement };
export type { MediaElementCandidate };
