import type { CaptureChunk } from "@/capture/accumulator";
import { concatenateChunks, countInitSegments, planFirstPlusMedia, planNaiveConcat } from "@/capture/decode-plan";
import { describe, expect, it } from "vitest";

function chunk(fill: number, isInitSegment: boolean, length = 4): CaptureChunk {
  return { bytes: new Uint8Array(length).fill(fill), isInitSegment };
}

describe("planNaiveConcat", () => {
  it("keeps every chunk's bytes in arrival order, regardless of init segment tagging", () => {
    const init = chunk(1, true);
    const media = chunk(2, false);
    const reinit = chunk(3, true);

    expect(planNaiveConcat([init, media, reinit])).toEqual([init.bytes, media.bytes, reinit.bytes]);
  });

  describe("edge cases", () => {
    it("returns an empty array for no chunks", () => {
      expect(planNaiveConcat([])).toEqual([]);
    });
  });
});

describe("planFirstPlusMedia", () => {
  it("keeps the first chunk and the media that belongs to it, up to the next init segment", () => {
    const first = chunk(1, true);
    const media1 = chunk(2, false);
    const reinit = chunk(3, true);
    const media2 = chunk(4, false);

    expect(planFirstPlusMedia([first, media1, reinit, media2])).toEqual([first.bytes, media1.bytes]);
  });

  it("keeps the first chunk even when it is not tagged as an init segment", () => {
    const first = chunk(1, false);
    const media = chunk(2, false);

    expect(planFirstPlusMedia([first, media])).toEqual([first.bytes, media.bytes]);
  });

  describe("edge cases", () => {
    it("returns an empty array for no chunks", () => {
      expect(planFirstPlusMedia([])).toEqual([]);
    });

    it("returns just the first chunk when there is only one", () => {
      const first = chunk(1, true);
      expect(planFirstPlusMedia([first])).toEqual([first.bytes]);
    });

    it("drops every later chunk when they are all re-initializations", () => {
      const first = chunk(1, true);
      const reinit1 = chunk(2, true);
      const reinit2 = chunk(3, true);

      expect(planFirstPlusMedia([first, reinit1, reinit2])).toEqual([first.bytes]);
    });
  });

  describe("regressions", () => {
    it("regression: stops at a re-initialization so a second track's media is never appended", () => {
      const trackOneInit = chunk(1, true);
      const trackOneMedia = chunk(2, false);
      const trackTwoInit = chunk(3, true);
      const trackTwoMedia = chunk(4, false);

      expect(planFirstPlusMedia([trackOneInit, trackOneMedia, trackTwoInit, trackTwoMedia])).toEqual([
        trackOneInit.bytes,
        trackOneMedia.bytes,
      ]);
    });

    it("regression: keeps nothing after the boundary however much media follows it", () => {
      const init = chunk(1, true);
      const media = chunk(2, false);
      const reinit = chunk(3, true);
      const later = [chunk(4, false), chunk(5, false), chunk(6, false)];

      expect(planFirstPlusMedia([init, media, reinit, ...later])).toEqual([init.bytes, media.bytes]);
    });
  });
});

describe("countInitSegments", () => {
  it("counts every chunk tagged as an init segment, including the first", () => {
    const chunks = [chunk(1, true), chunk(2, false), chunk(3, true)];
    expect(countInitSegments(chunks)).toBe(2);
  });

  describe("edge cases", () => {
    it("is zero for an empty list", () => {
      expect(countInitSegments([])).toBe(0);
    });

    it("is zero when no chunk is tagged as an init segment", () => {
      expect(countInitSegments([chunk(1, false), chunk(2, false)])).toBe(0);
    });
  });
});

describe("concatenateChunks", () => {
  it("joins byte arrays into one contiguous buffer in order", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);

    expect(concatenateChunks([a, b])).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  describe("edge cases", () => {
    it("returns a zero-length buffer for no parts", () => {
      expect(concatenateChunks([])).toEqual(new Uint8Array(0));
    });

    it("handles a single part", () => {
      const a = new Uint8Array([9, 9]);
      expect(concatenateChunks([a])).toEqual(new Uint8Array([9, 9]));
    });

    it("handles zero-length parts mixed with populated ones", () => {
      const a = new Uint8Array([1]);
      const empty = new Uint8Array(0);
      const b = new Uint8Array([2]);
      expect(concatenateChunks([a, empty, b])).toEqual(new Uint8Array([1, 2]));
    });
  });

  describe("invariants", () => {
    it("owns a fresh buffer: mutating an input part after the call does not change the result", () => {
      const a = new Uint8Array([1, 2, 3]);
      const result = concatenateChunks([a]);
      a[0] = 99;

      expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("the returned buffer's byteLength matches the sum of input lengths", () => {
      const parts = [new Uint8Array(3), new Uint8Array(7), new Uint8Array(2)];
      expect(concatenateChunks(parts).byteLength).toBe(12);
    });
  });
});
