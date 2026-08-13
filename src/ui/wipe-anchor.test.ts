import { describe, expect, it } from "vitest";
import { wipeElapsedMs } from "@/ui/wipe-anchor";

const FADE_MS = 8000;

describe("wipeElapsedMs", () => {
  it("puts a fresh wipe at the start", () => {
    expect(wipeElapsedMs(1000, 1000, FADE_MS)).toBe(0);
  });

  it("puts a wipe where the clock says, not where it was last inserted", () => {
    expect(wipeElapsedMs(1000, 4200, FADE_MS)).toBe(3200);
  });

  describe("edge cases", () => {
    it("never runs past the end of the fade", () => {
      expect(wipeElapsedMs(1000, 1000 + FADE_MS + 5000, FADE_MS)).toBe(FADE_MS);
    });

    it("never runs before the start, even if the clock goes backwards", () => {
      expect(wipeElapsedMs(4000, 1000, FADE_MS)).toBe(0);
    });

    it("answers the start for an unusable duration rather than a negative position", () => {
      expect(wipeElapsedMs(1000, 4200, 0)).toBe(0);
      expect(wipeElapsedMs(1000, 4200, Number.NaN)).toBe(0);
    });

    it("answers the start for an unusable clock", () => {
      expect(wipeElapsedMs(Number.NaN, 4200, FADE_MS)).toBe(0);
      expect(wipeElapsedMs(1000, Number.NaN, FADE_MS)).toBe(0);
    });
  });

  describe("invariants", () => {
    it("only ever moves forward as the clock does", () => {
      let previous = 0;
      for (let now = 1000; now <= 1000 + FADE_MS; now += 250) {
        const at = wipeElapsedMs(1000, now, FADE_MS);
        expect(at).toBeGreaterThanOrEqual(previous);
        previous = at;
      }
    });

    it("stays inside the fade for every clock value", () => {
      for (let now = -5000; now <= 20_000; now += 500) {
        const at = wipeElapsedMs(1000, now, FADE_MS);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThanOrEqual(FADE_MS);
      }
    });
  });

  describe("regressions", () => {
    it("regression: a dock remount midway resumes rather than restarting", () => {
      expect(wipeElapsedMs(0, 4000, FADE_MS)).toBe(4000);
    });

    it("regression: a remount after the fade's deadline does not rewind it", () => {
      expect(wipeElapsedMs(0, 9000, FADE_MS)).toBe(FADE_MS);
    });
  });
});
