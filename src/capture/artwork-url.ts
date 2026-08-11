// -- YouTube thumbnail resolution ----------------------------------------------
//
// Ported from better-lyrics-shaders, contents/lib/kawarpManager.ts
// (getVideoIdFromUrl, getHqFallbackUrl, placeholderCache, resolveImageUrl), so
// the two extensions show the same artwork for the same track. The semantics
// worth keeping exactly:
//   - a URL that is not an i.ytimg thumbnail is returned untouched and is not
//     cached, because there is nothing to probe
//   - maxresdefault does not exist for every video, and YouTube answers with a
//     120x90 default placeholder rather than a 404, so the size is the only
//     way to tell. That exact size means fall back to hqdefault
//   - a load error resolves to the original URL and is deliberately not
//     cached, so a transient failure does not stick for the session

const PLACEHOLDER_WIDTH = 120;
const PLACEHOLDER_HEIGHT = 90;

const THUMBNAIL_HOST_PATH = "i.ytimg.com/vi/";
const THUMBNAIL_ID_PATTERN = /i\.ytimg\.com\/vi\/([^/]+)\//;

interface LoadedSize {
  width: number;
  height: number;
}

type LoadImageSize = (url: string) => Promise<LoadedSize | null>;

function albumArtUrlForVideoId(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

function hqFallbackUrl(src: string): string | null {
  const match = src.match(THUMBNAIL_ID_PATTERN);
  if (!match) return null;
  return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
}

function isThumbnailUrl(url: string): boolean {
  return url.includes(THUMBNAIL_HOST_PATH);
}

function isPlaceholderThumbnail(size: LoadedSize): boolean {
  return size.width === PLACEHOLDER_WIDTH && size.height === PLACEHOLDER_HEIGHT;
}

interface ArtworkResolver {
  resolve(url: string): Promise<string>;
}

function createArtworkResolver(loadImageSize: LoadImageSize): ArtworkResolver {
  const resolved = new Map<string, string>();

  return {
    async resolve(url) {
      if (!isThumbnailUrl(url)) return url;

      const cached = resolved.get(url);
      if (cached !== undefined) return cached;

      const size = await loadImageSize(url);
      if (size === null) return url;

      if (isPlaceholderThumbnail(size)) {
        const fallback = hqFallbackUrl(url);
        if (fallback !== null) {
          resolved.set(url, fallback);
          return fallback;
        }
      }

      resolved.set(url, url);
      return url;
    },
  };
}

function loadImageSizeInPage(url: string): Promise<LoadedSize | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export {
  PLACEHOLDER_WIDTH,
  PLACEHOLDER_HEIGHT,
  albumArtUrlForVideoId,
  hqFallbackUrl,
  isThumbnailUrl,
  isPlaceholderThumbnail,
  createArtworkResolver,
  loadImageSizeInPage,
};
export type { ArtworkResolver, LoadImageSize, LoadedSize };
