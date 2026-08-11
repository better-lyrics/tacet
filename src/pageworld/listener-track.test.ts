import { describe, expect, it } from "vitest";
import { listenerTrackId } from "@/pageworld/listener-track";

const ADVANCE = { fromVideoId: "trackA", intoVideoId: "trackB" };

describe("listenerTrackId", () => {
  it("takes the player at its word when nothing is in flight", () => {
    expect(listenerTrackId({ playerVideoId: "trackA", advance: null })).toBe("trackA");
  });

  it("answers with the track we advanced into while the player still names the old one", () => {
    expect(listenerTrackId({ playerVideoId: "trackA", advance: ADVANCE })).toBe("trackB");
  });

  it("answers with the track we advanced into while the player names nothing", () => {
    expect(listenerTrackId({ playerVideoId: null, advance: ADVANCE })).toBe("trackB");
  });

  it("agrees with the player once the advance has landed", () => {
    expect(listenerTrackId({ playerVideoId: "trackB", advance: ADVANCE })).toBe("trackB");
  });

  describe("edge cases", () => {
    it("reports nothing when the player is silent and no advance is in flight", () => {
      expect(listenerTrackId({ playerVideoId: null, advance: null })).toBeNull();
    });

    it("treats an advance into the track already playing as a no-op", () => {
      const advance = { fromVideoId: "trackA", intoVideoId: "trackA" };
      expect(listenerTrackId({ playerVideoId: "trackA", advance })).toBe("trackA");
    });
  });

  describe("invariants", () => {
    it("never invents a track neither side named", () => {
      const answers = [
        listenerTrackId({ playerVideoId: "trackC", advance: ADVANCE }),
        listenerTrackId({ playerVideoId: null, advance: ADVANCE }),
        listenerTrackId({ playerVideoId: "trackA", advance: ADVANCE }),
        listenerTrackId({ playerVideoId: "trackC", advance: null }),
      ];
      for (const answer of answers) {
        expect(["trackA", "trackB", "trackC", null]).toContain(answer);
      }
    });

    it("never keeps naming the track we left while an advance out of it is in flight", () => {
      for (const playerVideoId of [null, "trackA", "trackB", "trackC"]) {
        expect(listenerTrackId({ playerVideoId, advance: ADVANCE })).not.toBe("trackA");
      }
    });
  });

  describe("regressions", () => {
    // The reported defect: a fade into trackB, an abort, and then the pipeline
    // reloading trackA's stems against a player that had not yet renamed
    // itself. Every check downstream compared trackA to a player still saying
    // trackA, agreed they matched, and started the wrong song at the new
    // track's playhead.
    it("regression: the track we faded out of is not the listener's track mid advance", () => {
      const answer = listenerTrackId({ playerVideoId: "trackA", advance: ADVANCE });
      expect(answer).toBe("trackB");
      expect(answer === "trackA").toBe(false);
    });

    it("regression: a listener skipping elsewhere mid advance outranks the advance", () => {
      expect(listenerTrackId({ playerVideoId: "trackC", advance: ADVANCE })).toBe("trackC");
    });
  });
});
