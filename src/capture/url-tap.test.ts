import { collectMatching, installUrlTap } from "@/capture/url-tap";
import type { FetchHost, XhrOpenHost } from "@/capture/url-tap";
import { describe, expect, it } from "vitest";

function fakeFetchHost(): FetchHost & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    fetch(...args: unknown[]) {
      calls.push(args);
      return "the real answer";
    },
  };
}

function fakeXhrPrototype(): XhrOpenHost & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    open(...args: unknown[]) {
      calls.push(args);
      return "opened";
    },
  };
}

describe("installUrlTap", () => {
  it("reports the url a fetch asks for and still makes the call", () => {
    const host = fakeFetchHost();
    const seen: string[] = [];
    installUrlTap({ fetchHost: host, xhrPrototype: null, onUrl: url => seen.push(url) });

    expect(host.fetch("https://rr3.googlevideo.com/videoplayback?itag=251")).toBe("the real answer");
    expect(seen).toEqual(["https://rr3.googlevideo.com/videoplayback?itag=251"]);
    expect(host.calls).toHaveLength(1);
  });

  it("reports the url an XMLHttpRequest opens, which is the second argument", () => {
    const prototype = fakeXhrPrototype();
    const seen: string[] = [];
    installUrlTap({ fetchHost: fakeFetchHost(), xhrPrototype: prototype, onUrl: url => seen.push(url) });

    prototype.open("GET", "https://rr3.googlevideo.com/videoplayback?itag=140", true);
    expect(seen).toEqual(["https://rr3.googlevideo.com/videoplayback?itag=140"]);
    expect(prototype.calls[0]).toEqual(["GET", "https://rr3.googlevideo.com/videoplayback?itag=140", true]);
  });

  it("reads the url off a Request-shaped first argument", () => {
    const host = fakeFetchHost();
    const seen: string[] = [];
    installUrlTap({ fetchHost: host, xhrPrototype: null, onUrl: url => seen.push(url) });

    host.fetch({ url: "https://rr3.googlevideo.com/videoplayback", method: "POST" });
    expect(seen).toEqual(["https://rr3.googlevideo.com/videoplayback"]);
  });

  it("reads a URL object", () => {
    const host = fakeFetchHost();
    const seen: string[] = [];
    installUrlTap({ fetchHost: host, xhrPrototype: null, onUrl: url => seen.push(url) });

    host.fetch(new URL("https://rr3.googlevideo.com/videoplayback"));
    expect(seen).toEqual(["https://rr3.googlevideo.com/videoplayback"]);
  });

  it("passes every argument through untouched", () => {
    const host = fakeFetchHost();
    installUrlTap({ fetchHost: host, xhrPrototype: null, onUrl: () => {} });

    const init = { method: "POST", body: "x" };
    host.fetch("https://example.test/", init);
    expect(host.calls[0]).toEqual(["https://example.test/", init]);
  });

  describe("edge cases", () => {
    it("makes the call even when the handler throws, because a tap must never break the page", () => {
      const host = fakeFetchHost();
      installUrlTap({
        fetchHost: host,
        xhrPrototype: null,
        onUrl: () => {
          throw new Error("the sink is broken");
        },
      });

      expect(() => host.fetch("https://example.test/")).not.toThrow();
      expect(host.calls).toHaveLength(1);
    });

    it("reports nothing for an argument carrying no url", () => {
      const host = fakeFetchHost();
      const seen: string[] = [];
      installUrlTap({ fetchHost: host, xhrPrototype: null, onUrl: url => seen.push(url) });

      host.fetch(undefined);
      host.fetch(null);
      host.fetch(7);
      host.fetch({});
      expect(seen).toEqual([]);
      expect(host.calls).toHaveLength(4);
    });

    it("tolerates having no XMLHttpRequest to patch", () => {
      const host = fakeFetchHost();
      expect(() => installUrlTap({ fetchHost: host, xhrPrototype: null, onUrl: () => {} })).not.toThrow();
    });

    it("keeps the caller's this, which XMLHttpRequest.open depends on", () => {
      const prototype: XhrOpenHost & { lastThis?: unknown } = {
        open(this: unknown) {
          (prototype as { lastThis?: unknown }).lastThis = this;
          return null;
        },
      };
      installUrlTap({ fetchHost: fakeFetchHost(), xhrPrototype: prototype, onUrl: () => {} });
      const instance = Object.create(prototype) as XhrOpenHost;
      instance.open("GET", "https://example.test/");
      expect(prototype.lastThis).toBe(instance);
    });
  });

  describe("invariants", () => {
    it("puts both originals back on restore", () => {
      const host = fakeFetchHost();
      const prototype = fakeXhrPrototype();
      const originalFetch = host.fetch;
      const originalOpen = prototype.open;

      const tap = installUrlTap({ fetchHost: host, xhrPrototype: prototype, onUrl: () => {} });
      expect(host.fetch).not.toBe(originalFetch);
      expect(prototype.open).not.toBe(originalOpen);

      tap.restore();
      expect(host.fetch).toBe(originalFetch);
      expect(prototype.open).toBe(originalOpen);
    });

    it("reports nothing once restored", () => {
      const host = fakeFetchHost();
      const seen: string[] = [];
      const tap = installUrlTap({ fetchHost: host, xhrPrototype: null, onUrl: url => seen.push(url) });
      tap.restore();
      host.fetch("https://rr3.googlevideo.com/videoplayback");
      expect(seen).toEqual([]);
    });
  });
});

describe("collectMatching", () => {
  it("keeps only the urls that match", () => {
    const collector = collectMatching("googlevideo.com", 10);
    collector.add("https://rr3.googlevideo.com/videoplayback?itag=251");
    collector.add("https://music.youtube.com/youtubei/v1/player");
    expect(collector.seen()).toEqual(["https://rr3.googlevideo.com/videoplayback?itag=251"]);
  });

  it("keeps them in the order they arrived", () => {
    const collector = collectMatching("x", 10);
    collector.add("x1");
    collector.add("x2");
    collector.add("x3");
    expect(collector.seen()).toEqual(["x1", "x2", "x3"]);
  });

  describe("edge cases", () => {
    it("starts empty", () => {
      expect(collectMatching("x", 10).seen()).toEqual([]);
      expect(collectMatching("x", 10).count()).toBe(0);
    });

    it("keeps a duplicate, since two requests to one url are two facts", () => {
      const collector = collectMatching("x", 10);
      collector.add("x1");
      collector.add("x1");
      expect(collector.count()).toBe(2);
    });
  });

  describe("invariants", () => {
    it("never grows past its limit, because a frame left running asks for a great deal", () => {
      const collector = collectMatching("x", 3);
      for (let index = 0; index < 100; index += 1) collector.add(`x${index}`);
      expect(collector.count()).toBe(3);
      expect(collector.seen()).toEqual(["x97", "x98", "x99"]);
    });

    it("hands back a copy, so a caller cannot corrupt what it holds", () => {
      const collector = collectMatching("x", 10);
      collector.add("x1");
      collector.seen().push("x2");
      expect(collector.seen()).toEqual(["x1"]);
    });
  });
});
