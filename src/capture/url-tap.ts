import { logError } from "@/capture/log";

// -- Watching what a frame asks for --------------------------------------------

interface FetchHost {
  fetch(...args: unknown[]): unknown;
}

interface XhrOpenHost {
  open(...args: unknown[]): unknown;
}

interface UrlTapOptions {
  fetchHost: FetchHost;
  xhrPrototype: XhrOpenHost | null;
  onUrl(url: string): void;
}

interface UrlTapHandle {
  restore(): void;
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null) {
    const candidate = (input as { url?: unknown }).url;
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function installUrlTap(options: UrlTapOptions): UrlTapHandle {
  const { fetchHost, xhrPrototype, onUrl } = options;

  const report = (input: unknown): void => {
    try {
      const url = urlOf(input);
      if (url) onUrl(url);
    } catch (error) {
      logError("a url tap handler threw, the request itself is unaffected", error);
    }
  };

  const originalFetch = fetchHost.fetch;
  fetchHost.fetch = function (this: unknown, ...args: unknown[]): unknown {
    report(args[0]);
    return originalFetch.apply(this, args);
  };

  const originalOpen = xhrPrototype?.open ?? null;
  if (xhrPrototype && originalOpen) {
    xhrPrototype.open = function (this: unknown, ...args: unknown[]): unknown {
      report(args[1]);
      return originalOpen.apply(this, args);
    };
  }

  function restore(): void {
    fetchHost.fetch = originalFetch;
    if (xhrPrototype && originalOpen) xhrPrototype.open = originalOpen;
  }

  return { restore };
}

// -- Holding what it asked for --------------------------------------------------

interface UrlCollector {
  seen(): string[];
  add(url: string): void;
  count(): number;
}

function collectMatching(pattern: string, limit: number): UrlCollector {
  const urls: string[] = [];
  return {
    seen: () => [...urls],
    count: () => urls.length,
    add(url: string) {
      if (!url.includes(pattern)) return;
      urls.push(url);
      if (urls.length > limit) urls.splice(0, urls.length - limit);
    },
  };
}

export { collectMatching, installUrlTap };
export type { FetchHost, UrlCollector, UrlTapHandle, UrlTapOptions, XhrOpenHost };
