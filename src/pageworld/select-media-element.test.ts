import { FALLBACK_ELEMENT_SELECTOR, selectPlaybackElement } from "@/pageworld/select-media-element";
import type { MediaElementCandidate } from "@/pageworld/select-media-element";
import { describe, expect, it } from "vitest";

function candidate(id: string, byteCount: number, matchesFallback: boolean): MediaElementCandidate & { id: string } {
  return {
    id,
    webkitAudioDecodedByteCount: byteCount,
    matches: (selector: string) => matchesFallback && selector === FALLBACK_ELEMENT_SELECTOR,
  };
}

describe("selectPlaybackElement", () => {
  it("picks the element that has actually decoded audio bytes", () => {
    const decoy = candidate("bls-video", 0, false);
    const real = candidate("real-player", 4096, true);
    expect(selectPlaybackElement([decoy, real])).toBe(real);
  });

  it("the decoy sorting first in the DOM does not win", () => {
    const decoy = candidate("bls-video", 0, false);
    const real = candidate("real-player", 4096, true);
    expect(selectPlaybackElement([decoy, real])).toBe(real);
  });

  it("falls back to the class selector when nothing has decoded bytes yet", () => {
    const decoy = candidate("bls-video", 0, false);
    const real = candidate("real-player", 0, true);
    expect(selectPlaybackElement([decoy, real])).toBe(real);
  });

  describe("edge cases", () => {
    it("returns null for an empty candidate list", () => {
      expect(selectPlaybackElement([])).toBeNull();
    });

    it("returns null when nothing decodes bytes and nothing matches the fallback", () => {
      const decoy = candidate("bls-video", 0, false);
      const other = candidate("something-else", 0, false);
      expect(selectPlaybackElement([decoy, other])).toBeNull();
    });

    it("treats a missing webkitAudioDecodedByteCount as zero, not a crash", () => {
      const noCountProperty: MediaElementCandidate = { matches: () => true };
      expect(selectPlaybackElement([noCountProperty])).toBe(noCountProperty);
    });

    it("picks the first decoding element when more than one has bytes", () => {
      const first = candidate("first", 10, false);
      const second = candidate("second", 20, false);
      expect(selectPlaybackElement([first, second])).toBe(first);
    });
  });

  describe("invariants", () => {
    it("is a pure function: does not mutate the candidate list", () => {
      const list = [candidate("a", 0, false), candidate("b", 5, false)];
      const snapshot = [...list];
      selectPlaybackElement(list);
      expect(list).toEqual(snapshot);
    });
  });
});
