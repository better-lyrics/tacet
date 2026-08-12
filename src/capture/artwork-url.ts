// -- YouTube thumbnail resolution ----------------------------------------------

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

// -- Asking for the size actually being drawn ----------------------------------

const SIZE_PARAMETER_PATTERN = /=w\d+-h\d+/;

function sizedArtworkUrl(url: string, cssPixels: number): string {
  const edge = Math.max(1, Math.round(cssPixels * 2));
  return url.replace(SIZE_PARAMETER_PATTERN, `=w${edge}-h${edge}`);
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
  sizedArtworkUrl,
  loadImageSizeInPage,
};
export type { ArtworkResolver, LoadImageSize, LoadedSize };
