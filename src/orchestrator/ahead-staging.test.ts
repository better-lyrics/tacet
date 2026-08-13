import { describe, expect, it } from "vitest";
import { AheadStaging } from "@/orchestrator/ahead-staging";
import { bytesToBase64 } from "@/relay/base64";

const chunkOf = (byte: number) => bytesToBase64(new Uint8Array([byte]));

function stageWhole(staging: AheadStaging, videoId: string, byte = 1): void {
  staging.addChunk(videoId, "vocals", 0, 1, chunkOf(byte));
  staging.addChunk(videoId, "instrumental", 0, 1, chunkOf(byte + 1));
  staging.markDone(videoId);
}

describe("AheadStaging", () => {
  it("holds nothing to begin with", () => {
    const staging = new AheadStaging();
    expect(staging.heldVideoId).toBeNull();
    expect(staging.assemblingVideoId).toBeNull();
  });

  it("assembles both stems and hands over the blobs once complete", async () => {
    const staging = new AheadStaging();
    stageWhole(staging, "next");
    const blobs = staging.finish("next");
    expect(blobs).not.toBeNull();
    expect(await blobs?.vocals.arrayBuffer()).toEqual(new Uint8Array([1]).buffer);
    expect(staging.heldVideoId).toBe("next");
  });

  it("answers with the blobs only once, so a staged track is announced once", () => {
    const staging = new AheadStaging();
    stageWhole(staging, "next");
    expect(staging.finish("next")).not.toBeNull();
    expect(staging.finish("next")).toBeNull();
  });

  it("keeps the blobs available to the page world until they are taken", () => {
    const staging = new AheadStaging();
    stageWhole(staging, "next");
    staging.finish("next");
    expect(staging.heldFor("next")).not.toBeNull();
    staging.releaseHeld("next");
    expect(staging.heldFor("next")).toBeNull();
  });

  describe("edge cases", () => {
    it("refuses to finish before every stem has arrived", () => {
      const staging = new AheadStaging();
      staging.addChunk("next", "vocals", 0, 1, chunkOf(1));
      staging.markDone("next");
      expect(staging.finish("next")).toBeNull();
    });

    it("refuses to finish before the pipeline says it is done", () => {
      const staging = new AheadStaging();
      staging.addChunk("next", "vocals", 0, 1, chunkOf(1));
      staging.addChunk("next", "instrumental", 0, 1, chunkOf(2));
      expect(staging.finish("next")).toBeNull();
    });

    it("answers nothing for a track it is not assembling", () => {
      const staging = new AheadStaging();
      stageWhole(staging, "next");
      expect(staging.finish("other")).toBeNull();
    });

    it("holds nothing for a track it never staged", () => {
      const staging = new AheadStaging();
      stageWhole(staging, "next");
      staging.finish("next");
      expect(staging.heldFor("other")).toBeNull();
    });

    it("releasing another track's hold leaves this one alone", () => {
      const staging = new AheadStaging();
      stageWhole(staging, "next");
      staging.finish("next");
      staging.releaseHeld("other");
      expect(staging.heldFor("next")).not.toBeNull();
    });

    it("drops the assembly rather than throwing when a chunk is out of range", () => {
      const staging = new AheadStaging();
      expect(staging.addChunk("next", "vocals", 5, 1, chunkOf(1))).toBe(false);
      expect(staging.assemblingVideoId).toBeNull();
    });
  });

  describe("invariants", () => {
    it("clearing leaves neither an assembly nor a hold", () => {
      const staging = new AheadStaging();
      stageWhole(staging, "next");
      staging.finish("next");
      staging.clear();
      expect(staging.heldVideoId).toBeNull();
      expect(staging.assemblingVideoId).toBeNull();
      expect(staging.heldFor("next")).toBeNull();
    });
  });

  describe("regressions", () => {
    it("regression: chunks for a second track restart the assembly rather than joining it", () => {
      const staging = new AheadStaging();
      staging.addChunk("first", "vocals", 0, 2, chunkOf(1));
      staging.addChunk("second", "vocals", 1, 2, chunkOf(9));
      expect(staging.assemblingVideoId).toBe("second");
      staging.markDone("second");
      // "second" only ever supplied one of its two chunks, so it cannot finish
      // on the back of what "first" had already contributed.
      expect(staging.finish("second")).toBeNull();
    });

    it("regression: a done flag set by one track does not complete another", () => {
      const staging = new AheadStaging();
      staging.markDone("first");
      staging.addChunk("second", "vocals", 0, 1, chunkOf(1));
      staging.addChunk("second", "instrumental", 0, 1, chunkOf(2));
      expect(staging.finish("second")).toBeNull();
    });
  });
});
