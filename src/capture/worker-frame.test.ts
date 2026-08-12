import { describe, expect, it } from "vitest";
import {
  buildMintUrl,
  buildWorkerUrl,
  isHiddenFrame,
  isMintFrame,
  isWorkerFrame,
  readWorkerAssignment,
  WORKER_PARAM,
} from "@/capture/worker-frame";

describe("buildWorkerUrl", () => {
  it("carries the video and the slice assignment", () => {
    const url = new URL(buildWorkerUrl("abc123", { index: 2, fromSeconds: 120.5, toSeconds: 180.75 }));
    expect(url.origin + url.pathname).toBe("https://music.youtube.com/watch");
    expect(url.searchParams.get("v")).toBe("abc123");
    expect(url.searchParams.get(WORKER_PARAM)).toBe("2:120.500:180.750");
  });

  it("round-trips through readWorkerAssignment", () => {
    const assignment = { index: 1, fromSeconds: 60.2, toSeconds: 120.3 };
    const parsed = readWorkerAssignment(new URL(buildWorkerUrl("v", assignment)).search);
    expect(parsed).toEqual(assignment);
  });
});

describe("readWorkerAssignment", () => {
  it("returns null for the real page, which carries no marker", () => {
    expect(readWorkerAssignment("?v=abc123")).toBeNull();
    expect(readWorkerAssignment("")).toBeNull();
  });

  describe("edge cases", () => {
    it("rejects a malformed marker rather than guessing", () => {
      expect(readWorkerAssignment(`?${WORKER_PARAM}=nonsense`)).toBeNull();
      expect(readWorkerAssignment(`?${WORKER_PARAM}=1:2`)).toBeNull();
      expect(readWorkerAssignment(`?${WORKER_PARAM}=1:2:3:4`)).toBeNull();
      expect(readWorkerAssignment(`?${WORKER_PARAM}=a:b:c`)).toBeNull();
    });

    it("rejects an inverted or empty slice", () => {
      expect(readWorkerAssignment(`?${WORKER_PARAM}=0:100:50`)).toBeNull();
      expect(readWorkerAssignment(`?${WORKER_PARAM}=0:50:50`)).toBeNull();
    });

    it("rejects a negative index or start", () => {
      expect(readWorkerAssignment(`?${WORKER_PARAM}=-1:0:60`)).toBeNull();
      expect(readWorkerAssignment(`?${WORKER_PARAM}=0:-5:60`)).toBeNull();
    });

    it("accepts a zero-length prefix slice starting at the very beginning", () => {
      expect(readWorkerAssignment(`?${WORKER_PARAM}=0:0:60`)).toEqual({
        index: 0,
        fromSeconds: 0,
        toSeconds: 60,
      });
    });
  });
});

describe("isWorkerFrame", () => {
  it("separates a worker frame from the real page", () => {
    expect(isWorkerFrame(`?v=x&${WORKER_PARAM}=0:0:60`)).toBe(true);
    expect(isWorkerFrame("?v=x")).toBe(false);
  });

  it("treats a malformed marker as the real page, never as a worker", () => {
    expect(isWorkerFrame(`?v=x&${WORKER_PARAM}=broken`)).toBe(false);
  });
});

describe("buildMintUrl", () => {
  it("names the track and marks the frame as a minting one", () => {
    const url = new URL(buildMintUrl("9E3jQcUkXdQ"));
    expect(url.origin).toBe("https://music.youtube.com");
    expect(url.pathname).toBe("/watch");
    expect(url.searchParams.get("v")).toBe("9E3jQcUkXdQ");
    expect(url.searchParams.get("blk-mint")).toBe("1");
  });

  it("carries no slice assignment, so a minting frame never captures", () => {
    expect(new URL(buildMintUrl("abc")).searchParams.has(WORKER_PARAM)).toBe(false);
    expect(isWorkerFrame(new URL(buildMintUrl("abc")).search)).toBe(false);
  });
});

describe("isMintFrame", () => {
  it("recognises the url it builds", () => {
    expect(isMintFrame(new URL(buildMintUrl("abc")).search)).toBe(true);
  });

  it("does not recognise the listener's own page", () => {
    expect(isMintFrame("?v=abc")).toBe(false);
    expect(isMintFrame("")).toBe(false);
  });

  it("does not recognise a slice frame", () => {
    expect(isMintFrame(new URL(buildWorkerUrl("abc", { index: 0, fromSeconds: 0, toSeconds: 10 })).search)).toBe(false);
  });

  describe("edge cases", () => {
    it("refuses a value that is not exactly one, so a stray parameter cannot arm it", () => {
      expect(isMintFrame("?blk-mint=0")).toBe(false);
      expect(isMintFrame("?blk-mint=")).toBe(false);
      expect(isMintFrame("?blk-mint=true")).toBe(false);
    });
  });
});

describe("isHiddenFrame", () => {
  it("recognises both jobs and nothing else", () => {
    expect(isHiddenFrame(new URL(buildMintUrl("abc")).search)).toBe(true);
    expect(isHiddenFrame(new URL(buildWorkerUrl("abc", { index: 0, fromSeconds: 0, toSeconds: 10 })).search)).toBe(
      true
    );
    expect(isHiddenFrame("?v=abc")).toBe(false);
  });
});
