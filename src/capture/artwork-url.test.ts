import {
  PLACEHOLDER_HEIGHT,
  PLACEHOLDER_WIDTH,
  albumArtUrlForVideoId,
  createArtworkResolver,
  hqFallbackUrl,
  isPlaceholderThumbnail,
  isThumbnailUrl,
  sizedArtworkUrl,
} from "@/capture/artwork-url";
import { describe, expect, it } from "vitest";

const VIDEO_ID = "HwBFSyIcIFI";
const MAXRES = `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`;
const HQ = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;

const PLACEHOLDER = { width: PLACEHOLDER_WIDTH, height: PLACEHOLDER_HEIGHT };
const REAL_ART = { width: 1280, height: 720 };

function countingLoader(sizes: Record<string, { width: number; height: number } | null>) {
  const calls: string[] = [];
  return {
    calls,
    load: async (url: string) => {
      calls.push(url);
      return url in sizes ? sizes[url] : REAL_ART;
    },
  };
}

describe("artwork url", () => {
  describe("happy path", () => {
    it("builds the maxres url for a video id", () => {
      expect(albumArtUrlForVideoId(VIDEO_ID)).toBe(MAXRES);
    });

    it("keeps a real thumbnail", async () => {
      const loader = countingLoader({ [MAXRES]: REAL_ART });
      await expect(createArtworkResolver(loader.load).resolve(MAXRES)).resolves.toBe(MAXRES);
    });

    it("falls back to hqdefault when maxres is the default placeholder", async () => {
      const loader = countingLoader({ [MAXRES]: PLACEHOLDER });
      await expect(createArtworkResolver(loader.load).resolve(MAXRES)).resolves.toBe(HQ);
    });
  });

  describe("edge cases", () => {
    it("returns a non-thumbnail url untouched and never probes it", async () => {
      const loader = countingLoader({});
      const url = "https://lh3.googleusercontent.com/abc=w544-h544";
      await expect(createArtworkResolver(loader.load).resolve(url)).resolves.toBe(url);
      expect(loader.calls).toEqual([]);
    });

    it("returns the original url when the image fails to load", async () => {
      const loader = countingLoader({ [MAXRES]: null });
      await expect(createArtworkResolver(loader.load).resolve(MAXRES)).resolves.toBe(MAXRES);
    });

    it("has no hq fallback for a url that is not a thumbnail", () => {
      expect(hqFallbackUrl("https://example.com/art.jpg")).toBeNull();
    });

    it("recognises thumbnail urls", () => {
      expect(isThumbnailUrl(MAXRES)).toBe(true);
      expect(isThumbnailUrl("https://lh3.googleusercontent.com/a")).toBe(false);
    });

    it("treats only exactly 120x90 as the placeholder", () => {
      expect(isPlaceholderThumbnail(PLACEHOLDER)).toBe(true);
      expect(isPlaceholderThumbnail({ width: 120, height: 91 })).toBe(false);
      expect(isPlaceholderThumbnail({ width: 121, height: 90 })).toBe(false);
      expect(isPlaceholderThumbnail({ width: 0, height: 0 })).toBe(false);
    });
  });

  describe("invariants", () => {
    it("probes a url once and answers from memory afterwards", async () => {
      const loader = countingLoader({ [MAXRES]: PLACEHOLDER });
      const resolver = createArtworkResolver(loader.load);
      await resolver.resolve(MAXRES);
      await resolver.resolve(MAXRES);
      await resolver.resolve(MAXRES);
      expect(loader.calls).toEqual([MAXRES]);
    });

    it("keeps separate answers for separate tracks", async () => {
      const otherMaxres = "https://i.ytimg.com/vi/DJCB1ZlseJ8/maxresdefault.jpg";
      const loader = countingLoader({ [MAXRES]: PLACEHOLDER, [otherMaxres]: REAL_ART });
      const resolver = createArtworkResolver(loader.load);
      await expect(resolver.resolve(MAXRES)).resolves.toBe(HQ);
      await expect(resolver.resolve(otherMaxres)).resolves.toBe(otherMaxres);
    });

    it("resolvers do not share a cache", async () => {
      const loader = countingLoader({ [MAXRES]: PLACEHOLDER });
      await createArtworkResolver(loader.load).resolve(MAXRES);
      await createArtworkResolver(loader.load).resolve(MAXRES);
      expect(loader.calls).toEqual([MAXRES, MAXRES]);
    });
  });

  describe("regressions", () => {
    it("regression: a load error is not cached, so the next attempt probes again", async () => {
      const sizes: Record<string, { width: number; height: number } | null> = { [MAXRES]: null };
      const calls: string[] = [];
      const resolver = createArtworkResolver(async url => {
        calls.push(url);
        return url in sizes ? sizes[url] : REAL_ART;
      });

      await expect(resolver.resolve(MAXRES)).resolves.toBe(MAXRES);
      sizes[MAXRES] = PLACEHOLDER;
      await expect(resolver.resolve(MAXRES)).resolves.toBe(HQ);
      expect(calls).toEqual([MAXRES, MAXRES]);
    });

    it("regression: an id containing a hyphen or underscore still yields a fallback", () => {
      expect(hqFallbackUrl("https://i.ytimg.com/vi/a_b-C9d/maxresdefault.jpg")).toBe(
        "https://i.ytimg.com/vi/a_b-C9d/hqdefault.jpg"
      );
    });

    it("regression: an hqdefault url that is itself a placeholder is not rewritten in a loop", async () => {
      const loader = countingLoader({ [HQ]: PLACEHOLDER });
      await expect(createArtworkResolver(loader.load).resolve(HQ)).resolves.toBe(HQ);
    });
  });
});

const SQUARE = "https://yt3.googleusercontent.com/X6tIdGPzwnsjdEauBFK5kq=w544-h544-l90-rj";

describe("sizedArtworkUrl", () => {
  describe("happy path", () => {
    it("asks for twice the box being drawn", () => {
      expect(sizedArtworkUrl(SQUARE, 34)).toBe(
        "https://yt3.googleusercontent.com/X6tIdGPzwnsjdEauBFK5kq=w68-h68-l90-rj"
      );
      expect(sizedArtworkUrl(SQUARE, 20)).toBe(
        "https://yt3.googleusercontent.com/X6tIdGPzwnsjdEauBFK5kq=w40-h40-l90-rj"
      );
    });

    it("keeps everything after the size, which is what makes it a square crop", () => {
      expect(sizedArtworkUrl(SQUARE, 34).endsWith("-l90-rj")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("leaves a url without a size parameter alone", () => {
      expect(sizedArtworkUrl(MAXRES, 34)).toBe(MAXRES);
    });

    it("rounds a fractional box up to a whole pixel", () => {
      expect(sizedArtworkUrl(SQUARE, 17.5)).toContain("=w35-h35");
    });

    it("never asks for a zero-pixel image", () => {
      expect(sizedArtworkUrl(SQUARE, 0)).toContain("=w1-h1");
      expect(sizedArtworkUrl(SQUARE, -8)).toContain("=w1-h1");
    });
  });

  describe("invariants", () => {
    it("is idempotent at the same size", () => {
      const once = sizedArtworkUrl(SQUARE, 34);
      expect(sizedArtworkUrl(once, 34)).toBe(once);
    });

    it("rewrites from any rung of the ladder to the same answer", () => {
      const small = SQUARE.replace("=w544-h544", "=w60-h60");
      expect(sizedArtworkUrl(small, 34)).toBe(sizedArtworkUrl(SQUARE, 34));
    });
  });
});
