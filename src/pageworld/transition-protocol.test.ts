import {
  isCrossfadeStartedMessage,
  isLoadStemsMessage,
  isRequestStagedDeckMessage,
  isSetCrossfadeMessage,
  isSetMixLevelMessage,
  isStageDeckMessage,
  isStagedReadyMessage,
  isStopStemsMessage,
} from "@/pageworld/protocol";
import type {
  CrossfadeStartedMessage,
  RequestStagedDeckMessage,
  SetCrossfadeMessage,
  StageDeckMessage,
  StagedReadyMessage,
} from "@/pageworld/protocol";
import { describe, expect, it } from "vitest";

const CHANNELS = (): Float32Array<ArrayBuffer>[] => [new Float32Array(4), new Float32Array(4)];

const staged: StagedReadyMessage = { type: "blk-staged-ready", videoId: "abc123" };
const request: RequestStagedDeckMessage = { type: "blk-request-staged-deck", videoId: "abc123" };
const stage: StageDeckMessage = {
  type: "blk-stage-deck",
  videoId: "abc123",
  vocals: CHANNELS(),
  instrumental: CHANNELS(),
  sampleRate: 48000,
};
const setCrossfade: SetCrossfadeMessage = { type: "blk-set-crossfade", seconds: 8 };
const started: CrossfadeStartedMessage = { type: "blk-crossfade-started", videoId: "abc123", durationSeconds: 8 };

describe("transition protocol", () => {
  it("accepts each message it was written for", () => {
    expect(isStagedReadyMessage(staged)).toBe(true);
    expect(isRequestStagedDeckMessage(request)).toBe(true);
    expect(isStageDeckMessage(stage)).toBe(true);
    expect(isSetCrossfadeMessage(setCrossfade)).toBe(true);
    expect(isCrossfadeStartedMessage(started)).toBe(true);
  });

  it("round-trips blk-stage-deck through structured clone with its samples intact", () => {
    const vocals = CHANNELS();
    vocals[0][2] = 0.25;
    const message: StageDeckMessage = { ...stage, vocals };
    const copy: unknown = structuredClone(message);
    expect(isStageDeckMessage(copy)).toBe(true);
    if (!isStageDeckMessage(copy)) throw new Error("guard rejected its own message");
    expect(copy.vocals[0][2]).toBeCloseTo(0.25, 6);
    expect(copy.sampleRate).toBe(48000);
  });

  describe("edge cases", () => {
    it("rejects a stage-deck message whose channels are not Float32Arrays", () => {
      expect(isStageDeckMessage({ ...stage, vocals: [[0, 1]] })).toBe(false);
      expect(isStageDeckMessage({ ...stage, instrumental: "silence" })).toBe(false);
    });

    it.each([
      ["videoId", { ...staged, videoId: 7 }],
      ["type", { ...staged, type: "blk-staged" }],
    ])("rejects a staged-ready message with a bad %s", (_field, malformed) => {
      expect(isStagedReadyMessage(malformed)).toBe(false);
    });

    it("accepts any numeric crossfade length, since the range check is the settings module's job", () => {
      for (const seconds of [0, 8, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(isSetCrossfadeMessage({ type: "blk-set-crossfade", seconds })).toBe(true);
      }
      expect(isSetCrossfadeMessage({ type: "blk-set-crossfade", seconds: "8" })).toBe(false);
    });

    it("rejects null, undefined and primitives everywhere", () => {
      for (const guard of [
        isStagedReadyMessage,
        isRequestStagedDeckMessage,
        isStageDeckMessage,
        isSetCrossfadeMessage,
        isCrossfadeStartedMessage,
      ]) {
        for (const value of [null, undefined, 0, "", [], true]) expect(guard(value)).toBe(false);
      }
    });

    it("an empty channel list is still a valid stage-deck message, matching load-stems", () => {
      expect(isStageDeckMessage({ ...stage, vocals: [], instrumental: [] })).toBe(true);
    });
  });

  describe("invariants", () => {
    const all = [
      { name: "blk-staged-ready", message: staged as unknown },
      { name: "blk-request-staged-deck", message: request as unknown },
      { name: "blk-stage-deck", message: stage as unknown },
      { name: "blk-set-crossfade", message: setCrossfade as unknown },
      { name: "blk-crossfade-started", message: started as unknown },
      { name: "blk-set-mix-level", message: { type: "blk-set-mix-level", mixLevel: 1 } as unknown },
      { name: "blk-stop-stems", message: { type: "blk-stop-stems" } as unknown },
    ];
    const guards = [
      isStagedReadyMessage,
      isRequestStagedDeckMessage,
      isStageDeckMessage,
      isSetCrossfadeMessage,
      isCrossfadeStartedMessage,
      isSetMixLevelMessage,
      isStopStemsMessage,
      isLoadStemsMessage,
    ];

    it("no message matches more than one guard, so a relay can dispatch on the first hit", () => {
      for (const { name, message } of all) {
        const matches = guards.filter(guard => guard(message)).length;
        expect(`${name}:${matches}`).toBe(`${name}:1`);
      }
    });

    it("blk-request-staged-deck and blk-staged-ready stay distinct despite the same shape", () => {
      expect(isStagedReadyMessage(request)).toBe(false);
      expect(isRequestStagedDeckMessage(staged)).toBe(false);
    });
  });

  describe("regressions", () => {
    it("regression: a crossfade-started message without a videoId is rejected, so the pipeline never stages a null", () => {
      expect(isCrossfadeStartedMessage({ type: "blk-crossfade-started", durationSeconds: 8 })).toBe(false);
    });

    it("regression: blk-load-stems is not mistaken for blk-stage-deck, since only one engages immediately", () => {
      const loadStems = { type: "blk-load-stems", videoId: "abc123", vocals: [], instrumental: [], sampleRate: 48000 };
      expect(isStageDeckMessage(loadStems)).toBe(false);
      expect(isLoadStemsMessage(stage)).toBe(false);
    });
  });
});
