import { ATTESTED_TOKEN_BYTES, chooseShadowUrl, judgeShadowUrl } from "@/acquisition/shadow-url";
import { readMintedUrl } from "@/acquisition/minted-url";
import { describe, expect, it } from "vitest";

const COLD_START_TOKEN = "a".repeat(16);
const ATTESTED_TOKEN = "a".repeat(116);

const shadowUrl = (overrides: Record<string, string | null> = {}) => {
  const url = new URL("https://rr3---sn-i3b7knse.googlevideo.com/videoplayback");
  const params: Record<string, string> = {
    itag: "141",
    mime: "audio/mp4",
    clen: "6064455",
    dur: "188.301",
    lmt: "1763427134620640",
    pot: ATTESTED_TOKEN,
    range: "0-1048575",
    rn: "3",
  };
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== null) url.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) url.searchParams.delete(key);
  }
  return url.href;
};

const target = { itag: 141, contentLengthBytes: 6_064_455 };

describe("judgeShadowUrl", () => {
  it("takes the attested url for the track that was asked for", () => {
    expect(judgeShadowUrl(readMintedUrl(shadowUrl()), target).usable).toBe(true);
  });

  it("refuses the cold-start url a fresh player emits first", () => {
    const judgement = judgeShadowUrl(readMintedUrl(shadowUrl({ pot: COLD_START_TOKEN })), target);
    expect(judgement.usable).toBe(false);
    expect(judgement.reason).toContain("rationed");
  });

  it("refuses a url for another format", () => {
    const judgement = judgeShadowUrl(readMintedUrl(shadowUrl({ itag: "251", clen: "3217513" })), target);
    expect(judgement.usable).toBe(false);
    expect(judgement.reason).toContain("itag 251");
  });

  it("refuses a url for another track of the same format", () => {
    const judgement = judgeShadowUrl(readMintedUrl(shadowUrl({ clen: "8164306" })), target);
    expect(judgement.usable).toBe(false);
    expect(judgement.reason).toContain("8164306");
  });

  describe("edge cases", () => {
    it("refuses a url that describes no stream", () => {
      expect(judgeShadowUrl(null, target).usable).toBe(false);
    });

    it("refuses a url carrying no token at all", () => {
      const judgement = judgeShadowUrl(readMintedUrl(shadowUrl({ pot: null })), target);
      expect(judgement.usable).toBe(false);
      expect(judgement.reason).toContain("no token");
    });

    it("accepts any length when the track's own length is not yet known", () => {
      const judgement = judgeShadowUrl(readMintedUrl(shadowUrl()), { itag: 141, contentLengthBytes: null });
      expect(judgement.usable).toBe(true);
    });

    it("still refuses a cold-start token when the length is not known", () => {
      const judgement = judgeShadowUrl(readMintedUrl(shadowUrl({ pot: COLD_START_TOKEN })), {
        itag: 141,
        contentLengthBytes: null,
      });
      expect(judgement.usable).toBe(false);
    });
  });

  describe("invariants", () => {
    it("draws the line inside the gap the measurements left", () => {
      expect(ATTESTED_TOKEN_BYTES).toBeGreaterThan(12);
      expect(ATTESTED_TOKEN_BYTES).toBeLessThan(87);
    });
  });
});

describe("chooseShadowUrl", () => {
  it("skips the cold-start urls and takes the attested one", () => {
    const chosen = chooseShadowUrl(
      [shadowUrl({ pot: COLD_START_TOKEN }), shadowUrl({ pot: COLD_START_TOKEN }), shadowUrl()],
      target
    );
    expect(chosen?.poToken?.byteLength).toBeGreaterThanOrEqual(ATTESTED_TOKEN_BYTES);
  });

  it("chooses nothing when only cold-start urls were seen", () => {
    expect(chooseShadowUrl([shadowUrl({ pot: COLD_START_TOKEN })], target)).toBeNull();
  });

  it("chooses nothing out of nothing", () => {
    expect(chooseShadowUrl([], target)).toBeNull();
  });

  describe("regressions", () => {
    it("regression: does not take the listener's own stream, which is a different track", () => {
      const listener = shadowUrl({ clen: "8164306", dur: "253.586" });
      expect(chooseShadowUrl([listener], target)).toBeNull();
    });

    it("regression: takes the attested url even when a matching cold-start one came first", () => {
      const chosen = chooseShadowUrl([shadowUrl({ pot: COLD_START_TOKEN }), shadowUrl()], target);
      expect(chosen).not.toBeNull();
      expect(chosen?.contentLengthBytes).toBe(6_064_455);
    });
  });
});
