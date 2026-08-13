import { describe, expect, it } from "vitest";
import { Staging } from "@/pageworld/staging";
import type { MixBuffer } from "@/pageworld/staging";

const stemsOf = (frames: number, sampleRate = 48000) => ({
  vocals: [new Float32Array(frames), new Float32Array(frames)],
  instrumental: [new Float32Array(frames), new Float32Array(frames)],
  sampleRate,
});

const mixOf = (duration: number): MixBuffer => ({ duration });

const staging = () => new Staging<MixBuffer>();

describe("Staging", () => {
  it("holds nothing to begin with", () => {
    const held = staging();
    expect(held.videoId).toBeNull();
    expect(held.state).toBe("none");
    expect(held.source()).toBeNull();
  });

  it("carries stems from offered to decoding to ready", () => {
    const held = staging();
    held.offerStems("next");
    expect(held.source()).toEqual({ videoId: "next", kind: "stems", state: "encoded" });

    expect(held.beginStemsDecode()).toBe("next");
    expect(held.state).toBe("decoding");

    expect(held.takeStems("next", stemsOf(480_000))).toBe(true);
    expect(held.state).toBe("ready");
    expect(held.audio("next")).toMatchObject({ kind: "stems", durationSeconds: 10 });
  });

  it("carries a mix from requested to ready", () => {
    const held = staging();
    held.beginMix("next");
    expect(held.source()).toEqual({ videoId: "next", kind: "mix", state: "decoding" });

    expect(held.takeMix("next", mixOf(186))).toBe(true);
    expect(held.state).toBe("ready");
    expect(held.audio("next")).toMatchObject({ kind: "mix", durationSeconds: 186 });
  });

  it("offers nothing to the graph until the audio has actually arrived", () => {
    const held = staging();
    held.offerStems("next");
    expect(held.audio("next")).toBeNull();
    held.beginMix("next");
    expect(held.audio("next")).toBeNull();
  });

  describe("edge cases", () => {
    it("refuses audio for a track it is not holding", () => {
      const held = staging();
      held.offerStems("next");
      expect(held.takeStems("other", stemsOf(4800))).toBe(false);
      expect(held.state).toBe("encoded");
    });

    it("refuses stems while holding a mix, and a mix while holding stems", () => {
      const held = staging();
      held.beginMix("next");
      expect(held.takeStems("next", stemsOf(4800))).toBe(false);

      held.offerStems("next");
      expect(held.takeMix("next", mixOf(10))).toBe(false);
    });

    it("answers nothing for a track it is not holding", () => {
      const held = staging();
      held.takeMix("next", mixOf(10));
      expect(held.audio("next")).toBeNull();
    });

    it("decoding stems when nothing is staged asks for nothing", () => {
      expect(staging().beginStemsDecode()).toBeNull();
    });

    it("a zero sample rate does not produce a non-finite duration", () => {
      const held = staging();
      held.offerStems("next");
      held.takeStems("next", stemsOf(4800, 0));
      expect(Number.isFinite(held.audio("next")?.durationSeconds ?? Number.NaN)).toBe(false);
    });
  });

  describe("abandoning a mix", () => {
    it("gives up on a mix that never came back and remembers it", () => {
      const held = staging();
      held.beginMix("next");
      expect(held.abandonMix("next")).toBe(true);
      expect(held.state).toBe("none");
      expect(held.mixIsUnavailable("next")).toBe(true);
    });

    it("never throws away a mix that already arrived", () => {
      const held = staging();
      held.beginMix("next");
      held.takeMix("next", mixOf(186));
      expect(held.abandonMix("next")).toBe(false);
      expect(held.state).toBe("ready");
    });

    it("forgets a track is unavailable once it is captured again", () => {
      const held = staging();
      held.markMixUnavailable("next");
      held.forgetMixUnavailable("next");
      expect(held.mixIsUnavailable("next")).toBe(false);
    });

    it("bounds what it remembers rather than growing for the life of the tab", () => {
      const held = staging();
      for (let index = 0; index < 40; index++) held.markMixUnavailable(`track-${index}`);
      expect(held.mixIsUnavailable("track-0")).toBe(false);
      expect(held.mixIsUnavailable("track-39")).toBe(true);
    });
  });

  describe("releasing", () => {
    it("releases what the listener has already reached", () => {
      const held = staging();
      held.offerStems("next");
      expect(held.releaseIfSpent("next", "next")).toBe(true);
      expect(held.state).toBe("none");
    });

    it("releases what is no longer the next track", () => {
      const held = staging();
      held.offerStems("next");
      expect(held.releaseIfSpent("somethingElse", "current")).toBe(true);
    });

    it("keeps what is still coming next", () => {
      const held = staging();
      held.offerStems("next");
      expect(held.releaseIfSpent("next", "current")).toBe(false);
      expect(held.state).toBe("encoded");
    });
  });

  describe("invariants", () => {
    it("a videoId and a state are always present together", () => {
      const held = staging();
      const steps: (() => void)[] = [
        () => held.offerStems("a"),
        () => held.beginStemsDecode(),
        () => held.takeStems("a", stemsOf(4800)),
        () => held.beginMix("b"),
        () => held.takeMix("b", mixOf(5)),
        () => held.clear(),
      ];
      for (const step of steps) {
        step();
        expect(held.videoId === null).toBe(held.state === "none");
      }
    });

    it("never reports ready without audio to play", () => {
      const held = staging();
      held.offerStems("a");
      held.beginStemsDecode();
      expect(held.state).not.toBe("ready");
      expect(held.audio("a")).toBeNull();
    });
  });

  describe("regressions", () => {
    it("regression: clearing leaves nothing armed, so no stale track can fade in", () => {
      const held = staging();
      held.offerStems("next");
      held.takeStems("next", stemsOf(4800));
      held.clear();
      expect(held.state).toBe("none");
      expect(held.videoId).toBeNull();
      expect(held.audio("next")).toBeNull();
      expect(held.source()).toBeNull();
    });

    it("regression: a second offer replaces the first rather than blending the two", () => {
      const held = staging();
      held.offerStems("first");
      held.takeStems("first", stemsOf(480_000));
      held.beginMix("second");
      expect(held.videoId).toBe("second");
      expect(held.kind).toBe("mix");
      expect(held.audio("first")).toBeNull();
      expect(held.audio("second")).toBeNull();
    });
  });
});
