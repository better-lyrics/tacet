import { judgeMintedUrl, pickMintedUrl, readMintedUrl } from "@/acquisition/minted-url";
import { describe, expect, it } from "vitest";

const mintedUrl = (overrides: Record<string, string | null> = {}) => {
  const url = new URL("https://rr3---sn-i3b7knse.googlevideo.com/videoplayback");
  const params: Record<string, string> = {
    expire: "1786565423",
    ei: "z358arCyMPe12roPgfbekQU",
    itag: "251",
    source: "youtube",
    mime: "audio/webm",
    gir: "yes",
    clen: "3217513",
    dur: "188.321",
    lmt: "1763427134620640",
    n: "ykoc9zwv5lI7Iw",
    sig: "AE0s2JYwRQIhAJlCXBjYPz6o",
    cpn: "6_cNqM_AMz-B7Pub",
    cver: "1.20260804.16.00",
    pot: "MlPxOc4LqNwTV_EFGPApR0tLo264fP84mgqfHYMm",
    range: "826992-1328506",
    rn: "7",
    rbuf: "31924",
    ump: "1",
    srfvp: "1",
  };
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value === null) continue;
    url.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) url.searchParams.delete(key);
  }
  return url.href;
};

describe("readMintedUrl", () => {
  it("reads the format the url was minted for", () => {
    const minted = readMintedUrl(mintedUrl());
    expect(minted?.itag).toBe(251);
    expect(minted?.lastModified).toBe(1_763_427_134_620_640n);
    expect(minted?.contentLengthBytes).toBe(3_217_513);
    expect(minted?.durationSeconds).toBeCloseTo(188.321, 6);
    expect(minted?.mimeType).toBe("audio/webm");
  });

  it("decodes the token the player already minted", () => {
    expect(readMintedUrl(mintedUrl())?.poToken).toBeInstanceOf(Uint8Array);
    expect(readMintedUrl(mintedUrl())?.poToken?.length).toBeGreaterThan(0);
  });

  it("strips the parameters that become ours once we are driving", () => {
    const url = new URL(readMintedUrl(mintedUrl())?.url ?? "");
    expect(url.searchParams.has("range")).toBe(false);
    expect(url.searchParams.has("rn")).toBe(false);
    expect(url.searchParams.has("rbuf")).toBe(false);
  });

  it("keeps everything that makes the url valid", () => {
    const url = new URL(readMintedUrl(mintedUrl())?.url ?? "");
    for (const kept of ["expire", "ei", "n", "sig", "pot", "cpn", "cver", "ump", "srfvp"]) {
      expect(url.searchParams.has(kept)).toBe(true);
    }
  });

  describe("edge cases", () => {
    it("refuses a url that is not googlevideo", () => {
      expect(readMintedUrl("https://music.youtube.com/watch?v=abc&itag=251&clen=1")).toBeNull();
    });

    it("refuses text that is not a url at all", () => {
      expect(readMintedUrl("not a url")).toBeNull();
      expect(readMintedUrl("")).toBeNull();
    });

    it("refuses a url naming no format or no length, since neither can be guessed", () => {
      expect(readMintedUrl(mintedUrl({ itag: null }))).toBeNull();
      expect(readMintedUrl(mintedUrl({ clen: null }))).toBeNull();
      expect(readMintedUrl(mintedUrl({ clen: "0" }))).toBeNull();
    });

    it("reads a missing last-modified stamp as zero rather than refusing the url", () => {
      expect(readMintedUrl(mintedUrl({ lmt: null }))?.lastModified).toBe(0n);
    });

    it("reads a missing duration as NaN, which the judgement then refuses", () => {
      expect(readMintedUrl(mintedUrl({ dur: null }))?.durationSeconds).toBeNaN();
    });

    it("reads a url carrying no token, which is what an unauthenticated mint looks like", () => {
      expect(readMintedUrl(mintedUrl({ pot: null }))?.poToken).toBeNull();
    });

    it("accepts any googlevideo host, since the edge node changes per mint", () => {
      const other = mintedUrl().replace("rr3---sn-i3b7knse", "rr9---sn-ajun55-54");
      expect(readMintedUrl(other)?.itag).toBe(251);
    });
  });

  describe("invariants", () => {
    it("is idempotent, so a url already stripped reads the same", () => {
      const once = readMintedUrl(mintedUrl())?.url ?? "";
      expect(readMintedUrl(once)?.url).toBe(once);
    });

    it("never returns a url the caller cannot parse", () => {
      expect(() => new URL(readMintedUrl(mintedUrl())?.url ?? "")).not.toThrow();
    });
  });
});

describe("judgeMintedUrl", () => {
  it("accepts a url as long as the track", () => {
    expect(judgeMintedUrl(readMintedUrl(mintedUrl()), 188)).toEqual({
      usable: true,
      reason: "the url describes the track",
    });
  });

  it("accepts the second or so that a stream and its track routinely differ by", () => {
    expect(judgeMintedUrl(readMintedUrl(mintedUrl()), 189).usable).toBe(true);
    expect(judgeMintedUrl(readMintedUrl(mintedUrl()), 187).usable).toBe(true);
  });

  describe("edge cases", () => {
    it("refuses nothing at all", () => {
      expect(judgeMintedUrl(null, 188).usable).toBe(false);
    });

    it("refuses a url that states no duration, since an ad cannot be ruled out", () => {
      expect(judgeMintedUrl(readMintedUrl(mintedUrl({ dur: null })), 188).usable).toBe(false);
    });

    it("refuses to judge against a track length it does not know", () => {
      for (const unknown of [Number.NaN, 0, -1]) {
        expect(judgeMintedUrl(readMintedUrl(mintedUrl()), unknown).usable).toBe(false);
      }
    });

    it("refuses a url longer than the track as well as shorter", () => {
      expect(judgeMintedUrl(readMintedUrl(mintedUrl({ dur: "400" })), 188).usable).toBe(false);
    });
  });

  describe("regressions", () => {
    it("regression: refuses a preroll ad's url, which is healthy in every way but its length", () => {
      const advertisement = readMintedUrl(mintedUrl({ dur: "15.041", clen: "285942", lmt: "1784898777025168" }));
      expect(advertisement?.itag).toBe(251);
      expect(advertisement?.poToken).not.toBeNull();
      const judged = judgeMintedUrl(advertisement, 188.321);
      expect(judged.usable).toBe(false);
      expect(judged.reason).toContain("advertisement");
      expect(judged.reason).toContain("15.0s");
    });
  });
});

describe("pickMintedUrl", () => {
  const advertisement = mintedUrl({ dur: "15.041", clen: "285942" });
  const track = mintedUrl();

  it("takes the url that describes the track", () => {
    expect(pickMintedUrl([track], 188)?.contentLengthBytes).toBe(3_217_513);
  });

  it("walks past an advertisement to reach the track", () => {
    expect(pickMintedUrl([advertisement, track], 188)?.contentLengthBytes).toBe(3_217_513);
  });

  it("takes the earliest match, because an earlier url has more life left", () => {
    const later = mintedUrl({ expire: "1786999999" });
    expect(new URL(pickMintedUrl([track, later], 188)?.url ?? "").searchParams.get("expire")).toBe("1786565423");
  });

  describe("edge cases", () => {
    it("answers null for nothing at all", () => {
      expect(pickMintedUrl([], 188)).toBeNull();
    });

    it("answers null when only an advertisement was minted", () => {
      expect(pickMintedUrl([advertisement], 188)).toBeNull();
    });

    it("walks past urls that are not streams at all", () => {
      const noise = ["https://music.youtube.com/youtubei/v1/player", "not a url", ""];
      expect(pickMintedUrl([...noise, track], 188)?.itag).toBe(251);
    });

    it("answers null when the track length is unknown, rather than taking the first thing it sees", () => {
      expect(pickMintedUrl([advertisement, track], Number.NaN)).toBeNull();
    });
  });

  describe("regressions", () => {
    it("regression: an advertisement minted before the track is never returned", () => {
      for (const order of [
        [advertisement, track],
        [advertisement, advertisement, track],
      ]) {
        expect(pickMintedUrl(order, 188.321)?.durationSeconds).toBeCloseTo(188.321, 3);
      }
      expect(pickMintedUrl([advertisement, advertisement], 188.321)).toBeNull();
    });
  });
});
