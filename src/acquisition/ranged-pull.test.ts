import { MAX_REDIRECTS, planRanges, pullRanged, rangedUrl, readRedirect } from "@/acquisition/ranged-pull";
import type { RangedResponse, RangedTransport } from "@/acquisition/ranged-pull";
import { describe, expect, it } from "vitest";

const URL_UNDER_TEST =
  "https://rr3---sn-i3b7knse.googlevideo.com/videoplayback?itag=141&clen=2500&dur=188.301&range=99-199&rn=7&rbuf=31924&ump=1&srfvp=1";

const served = (range: string): Uint8Array => {
  const [start, end] = range.split("-").map(Number);
  return new Uint8Array(end - start + 1).fill(1);
};

const bytesTransport =
  (
    options: { total: number; fail?: (url: string, attempt: number) => RangedResponse | "throw" | null } = {
      total: 2500,
    }
  ): RangedTransport =>
  async url => {
    const parsed = new URL(url);
    const range = parsed.searchParams.get("range") ?? "0-0";
    const attempt = Number(parsed.searchParams.get("rn"));
    const forced = options.fail?.(url, attempt);
    if (forced === "throw") throw new Error("the socket died");
    if (forced) return forced;
    return { status: 200, bytes: served(range) };
  };

const textResponse = (text: string): RangedResponse => ({ status: 200, bytes: new TextEncoder().encode(text) });

describe("planRanges", () => {
  it("covers the whole length in windows", () => {
    expect(planRanges(2500, 1000)).toEqual([
      { start: 0, end: 999 },
      { start: 1000, end: 1999 },
      { start: 2000, end: 2499 },
    ]);
  });

  it("clamps the last window to the final byte", () => {
    const ranges = planRanges(2500, 1000);
    expect(ranges[ranges.length - 1].end).toBe(2499);
  });

  it("asks for one window when it is larger than the track", () => {
    expect(planRanges(500, 1000)).toEqual([{ start: 0, end: 499 }]);
  });

  describe("edge cases", () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("plans nothing for a length of %s", length => {
      expect(planRanges(length, 1000)).toEqual([]);
    });

    it.each([0, -1, Number.NaN])("plans nothing for a window of %s", windowBytes => {
      expect(planRanges(2500, windowBytes)).toEqual([]);
    });

    it("plans a single byte", () => {
      expect(planRanges(1, 1000)).toEqual([{ start: 0, end: 0 }]);
    });
  });

  describe("invariants", () => {
    it.each([
      [2500, 1000],
      [1, 1],
      [6_064_455, 1_048_576],
      [999_999, 7],
    ])("covers every byte of %s exactly once in windows of %s", (total, windowBytes) => {
      const ranges = planRanges(total, windowBytes);
      expect(ranges[0].start).toBe(0);
      expect(ranges[ranges.length - 1].end).toBe(total - 1);
      const covered = ranges.reduce((sum, range) => sum + (range.end - range.start + 1), 0);
      expect(covered).toBe(total);
      for (let i = 1; i < ranges.length; i += 1) expect(ranges[i].start).toBe(ranges[i - 1].end + 1);
    });
  });
});

describe("rangedUrl", () => {
  it("addresses the window it was given", () => {
    const url = new URL(rangedUrl(URL_UNDER_TEST, { start: 1000, end: 1999 }, 3));
    expect(url.searchParams.get("range")).toBe("1000-1999");
    expect(url.searchParams.get("rn")).toBe("3");
  });

  it("strips the parameters that frame the response rather than describe the media", () => {
    const url = new URL(rangedUrl(URL_UNDER_TEST, { start: 0, end: 9 }, 1));
    expect(url.searchParams.has("ump")).toBe(false);
    expect(url.searchParams.has("srfvp")).toBe(false);
    expect(url.searchParams.has("rbuf")).toBe(false);
  });

  it("keeps what makes the url valid", () => {
    const url = new URL(rangedUrl(URL_UNDER_TEST, { start: 0, end: 9 }, 1));
    expect(url.searchParams.get("itag")).toBe("141");
    expect(url.searchParams.get("clen")).toBe("2500");
  });

  describe("regressions", () => {
    it("regression: overwrites the range the player baked in rather than appending a second one", () => {
      const url = new URL(rangedUrl(URL_UNDER_TEST, { start: 5, end: 6 }, 1));
      expect(url.searchParams.getAll("range")).toEqual(["5-6"]);
    });
  });
});

describe("readRedirect", () => {
  it("recognises a url served in place of media", () => {
    expect(readRedirect(new TextEncoder().encode("https://rr5---sn-abc.googlevideo.com/videoplayback?x=1"))).toBe(
      "https://rr5---sn-abc.googlevideo.com/videoplayback?x=1"
    );
  });

  it("tolerates the trailing whitespace the server sends", () => {
    expect(readRedirect(new TextEncoder().encode("https://example.googlevideo.com/v\n"))).toBe(
      "https://example.googlevideo.com/v"
    );
  });

  describe("edge cases", () => {
    it("reads no redirect out of media bytes", () => {
      expect(readRedirect(new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]))).toBeNull();
    });

    it("reads no redirect out of nothing", () => {
      expect(readRedirect(new Uint8Array())).toBeNull();
    });

    it("reads no redirect out of a body too large to be one", () => {
      expect(readRedirect(new Uint8Array(1_048_576).fill(65))).toBeNull();
    });

    it("reads no redirect out of text that is not a url", () => {
      expect(readRedirect(new TextEncoder().encode("not a url at all"))).toBeNull();
    });
  });
});

describe("pullRanged", () => {
  it("pulls a whole track and reports the bytes", async () => {
    const result = await pullRanged({
      url: URL_UNDER_TEST,
      contentLengthBytes: 2500,
      windowBytes: 1000,
      send: bytesTransport(),
    });
    expect(result.ok).toBe(true);
    expect(result.bytes.byteLength).toBe(2500);
  });

  it("reports progress as the windows land", async () => {
    const seen: number[] = [];
    await pullRanged({
      url: URL_UNDER_TEST,
      contentLengthBytes: 2500,
      windowBytes: 1000,
      concurrency: 1,
      send: bytesTransport(),
      onProgress: received => seen.push(received),
    });
    expect(seen).toEqual([1000, 2000, 2500]);
  });

  it("follows a redirect served in place of the first window", async () => {
    let redirected = false;
    const result = await pullRanged({
      url: URL_UNDER_TEST,
      contentLengthBytes: 2500,
      windowBytes: 1000,
      send: async (url, signal) => {
        if (!redirected) {
          redirected = true;
          return textResponse("https://rr9---sn-moved.googlevideo.com/videoplayback?itag=141&clen=2500");
        }
        expect(url).toContain("sn-moved");
        return bytesTransport()(url, signal);
      },
    });
    expect(result.ok).toBe(true);
    expect(result.redirects).toBe(1);
  });

  it("retries a window that times out, then completes", async () => {
    let failures = 0;
    const result = await pullRanged({
      url: URL_UNDER_TEST,
      contentLengthBytes: 2500,
      windowBytes: 1000,
      concurrency: 1,
      send: async (url, signal) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get("range") === "1000-1999" && failures < 2) {
          failures += 1;
          return { status: 503, bytes: new Uint8Array() };
        }
        return bytesTransport()(url, signal);
      },
    });
    expect(result.ok).toBe(true);
    expect(result.retries).toBeGreaterThanOrEqual(2);
  });

  describe("edge cases", () => {
    it("refuses a track of no stated length", async () => {
      const result = await pullRanged({ url: URL_UNDER_TEST, contentLengthBytes: 0, send: bytesTransport() });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("no length");
    });

    it("refuses when the pull would take more requests than allowed", async () => {
      const result = await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 2500,
        windowBytes: 10,
        maxRequests: 5,
        send: bytesTransport(),
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("requests");
    });

    it("refuses when the url keeps redirecting", async () => {
      const result = await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 2500,
        windowBytes: 1000,
        send: async () => textResponse("https://rr9---sn-loop.googlevideo.com/videoplayback"),
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("redirect");
      expect(result.redirects).toBeLessThanOrEqual(MAX_REDIRECTS);
    });

    it("refuses when a window never arrives in full", async () => {
      const result = await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 2500,
        windowBytes: 1000,
        attempts: 2,
        send: async url =>
          new URL(url).searchParams.get("range") === "1000-1999"
            ? { status: 200, bytes: new Uint8Array(7) }
            : { status: 200, bytes: served(new URL(url).searchParams.get("range") ?? "0-0") },
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("byte 1000");
    });

    it("refuses a first request that is answered with an error status", async () => {
      const result = await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 2500,
        send: async () => ({ status: 403, bytes: new Uint8Array() }),
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("403");
    });
  });

  describe("invariants", () => {
    it("assembles the windows in order whatever order they arrive in", async () => {
      const result = await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 30,
        windowBytes: 10,
        concurrency: 3,
        send: async url => {
          const [start, end] = (new URL(url).searchParams.get("range") ?? "0-0").split("-").map(Number);
          await new Promise(resolve => setTimeout(resolve, start === 0 ? 20 : 1));
          const bytes = new Uint8Array(end - start + 1);
          for (let i = 0; i < bytes.length; i += 1) bytes[i] = start + i;
          return { status: 200, bytes };
        },
      });
      expect(result.ok).toBe(true);
      expect([...result.bytes]).toEqual([...Array(30).keys()]);
    });

    it("never serves fewer bytes than it claims", async () => {
      const result = await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 2500,
        windowBytes: 400,
        send: bytesTransport(),
      });
      expect(result.bytes.byteLength).toBe(2500);
    });
  });

  describe("regressions", () => {
    it("regression: a redirect is resolved once up front rather than raced by every worker", async () => {
      const asked: string[] = [];
      await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 4000,
        windowBytes: 1000,
        concurrency: 4,
        send: async (url, signal) => {
          asked.push(url);
          if (asked.length === 1) return textResponse("https://rr9---sn-moved.googlevideo.com/videoplayback");
          return bytesTransport()(url, signal);
        },
      });
      expect(asked.slice(1).every(url => url.includes("sn-moved"))).toBe(true);
    });

    it("regression: a two byte probe precedes the windows, so no worker discovers the redirect", async () => {
      const ranges: string[] = [];
      await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 2000,
        windowBytes: 1000,
        send: async (url, signal) => {
          ranges.push(new URL(url).searchParams.get("range") ?? "");
          return bytesTransport()(url, signal);
        },
      });
      expect(ranges[0]).toBe("0-1");
    });

    it("regression: a throwing transport is retried rather than killing the pull", async () => {
      let thrown = 0;
      const result = await pullRanged({
        url: URL_UNDER_TEST,
        contentLengthBytes: 2000,
        windowBytes: 1000,
        concurrency: 1,
        send: async (url, signal) => {
          if (new URL(url).searchParams.get("range") === "0-999" && thrown === 0) {
            thrown += 1;
            throw new Error("the socket died");
          }
          return bytesTransport()(url, signal);
        },
      });
      expect(result.ok).toBe(true);
    });
  });
});
