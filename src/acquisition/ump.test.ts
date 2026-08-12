import { UMP_PART, joinBytes, readUmp, readUmpVarint, umpPartName } from "@/acquisition/ump";
import { describe, expect, it } from "vitest";

const bytes = (...values: number[]) => new Uint8Array(values);

const part = (type: number, ...payload: number[]) => bytes(type, payload.length, ...payload);

describe("readUmpVarint", () => {
  it("reads a one-byte varint, which is every part type we care about", () => {
    expect(readUmpVarint(bytes(21), 0)).toEqual({ value: 21, next: 1 });
    expect(readUmpVarint(bytes(127), 0)).toEqual({ value: 127, next: 1 });
  });

  it("reads a two-byte varint, whose width lives in the leading one-bits", () => {
    expect(readUmpVarint(bytes(0x80, 0x02), 0)).toEqual({ value: 128, next: 2 });
    expect(readUmpVarint(bytes(0xbf, 0xff), 0)).toEqual({ value: 16_383, next: 2 });
  });

  it("reads a three-byte varint", () => {
    expect(readUmpVarint(bytes(0xc0, 0x00, 0x02), 0)).toEqual({ value: 16_384, next: 3 });
  });

  it("reads a four-byte varint", () => {
    expect(readUmpVarint(bytes(0xe0, 0x00, 0x00, 0x02), 0)).toEqual({ value: 2_097_152, next: 4 });
  });

  it("reads a five-byte varint as a little-endian uint32 after the prefix", () => {
    expect(readUmpVarint(bytes(0xff, 0x00, 0x00, 0x00, 0x01), 0)).toEqual({ value: 16_777_216, next: 5 });
  });

  describe("edge cases", () => {
    it("answers null past the end", () => {
      expect(readUmpVarint(bytes(), 0)).toBeNull();
      expect(readUmpVarint(bytes(21), 1)).toBeNull();
    });

    it("answers null when the width runs past the end rather than reading short", () => {
      expect(readUmpVarint(bytes(0x80), 0)).toBeNull();
      expect(readUmpVarint(bytes(0xff, 0x00, 0x00), 0)).toBeNull();
    });

    it("reads from an offset inside the input", () => {
      expect(readUmpVarint(bytes(9, 9, 21), 2)).toEqual({ value: 21, next: 3 });
    });

    it("reads a value above two billion without going negative", () => {
      expect(readUmpVarint(bytes(0xff, 0xff, 0xff, 0xff, 0xff), 0)).toEqual({ value: 4_294_967_295, next: 5 });
    });
  });

  describe("regressions", () => {
    it("regression: a subarray view is read from its own offset, which the five-byte path gets wrong if it uses the backing buffer", () => {
      const backing = bytes(0xaa, 0xaa, 0xff, 0x01, 0x00, 0x00, 0x00);
      expect(readUmpVarint(backing.subarray(2), 0)).toEqual({ value: 1, next: 5 });
    });
  });
});

describe("readUmp", () => {
  it("reads a sequence of parts and names them", () => {
    const input = joinBytes([part(UMP_PART.mediaHeader, 1, 2), part(UMP_PART.media, 3, 4, 5)]);
    const { parts, remainder } = readUmp(input);
    expect(parts.map(found => found.name)).toEqual(["mediaHeader", "media"]);
    expect(parts[1].payload).toEqual(bytes(3, 4, 5));
    expect(remainder).toEqual(bytes());
  });

  it("reads a part whose payload is empty", () => {
    const { parts } = readUmp(part(UMP_PART.mediaEnd));
    expect(parts).toHaveLength(1);
    expect(parts[0].payload).toEqual(bytes());
  });

  it("reads a payload longer than a one-byte size", () => {
    const payload = new Uint8Array(300).fill(7);
    const input = joinBytes([bytes(UMP_PART.media, 0x80 | (300 & 0x3f), 300 >> 6), payload]);
    const { parts } = readUmp(input);
    expect(parts[0].payload).toHaveLength(300);
    expect(parts[0].payload).toEqual(payload);
  });

  describe("edge cases", () => {
    it("reads nothing from an empty response", () => {
      expect(readUmp(bytes())).toEqual({ parts: [], remainder: bytes() });
    });

    it("hands back a part whose payload is incomplete rather than reporting it truncated", () => {
      const cut = bytes(UMP_PART.media, 4, 1, 2);
      const { parts, remainder } = readUmp(cut);
      expect(parts).toEqual([]);
      expect(remainder).toEqual(cut);
    });

    it("hands back a header cut mid-varint", () => {
      const { parts, remainder } = readUmp(bytes(UMP_PART.media));
      expect(parts).toEqual([]);
      expect(remainder).toEqual(bytes(UMP_PART.media));
    });

    it("keeps every complete part before the cut", () => {
      const input = joinBytes([part(UMP_PART.mediaHeader, 1), bytes(UMP_PART.media, 9, 1)]);
      const { parts, remainder } = readUmp(input);
      expect(parts.map(found => found.type)).toEqual([UMP_PART.mediaHeader]);
      expect(remainder).toEqual(bytes(UMP_PART.media, 9, 1));
    });

    it("names a part type it has never seen without throwing", () => {
      expect(umpPartName(9999)).toBe("type-9999");
      expect(readUmp(part(9)).parts[0].name).toBe("type-9");
    });
  });

  describe("invariants", () => {
    it("resumes across a split at any byte, which is what a chunked response does", () => {
      const whole = joinBytes([
        part(UMP_PART.mediaHeader, 1, 2, 3),
        part(UMP_PART.media, 4, 5),
        part(UMP_PART.mediaEnd, 6),
      ]);
      for (let cut = 0; cut <= whole.length; cut += 1) {
        const first = readUmp(whole.subarray(0, cut));
        const rest = readUmp(joinBytes([first.remainder, whole.subarray(cut)]));
        const seen = [...first.parts, ...rest.parts];
        expect(seen.map(found => found.type)).toEqual([UMP_PART.mediaHeader, UMP_PART.media, UMP_PART.mediaEnd]);
        expect(rest.remainder).toEqual(bytes());
      }
    });

    it("accounts for every byte, either in a part or in the remainder", () => {
      const whole = joinBytes([part(UMP_PART.media, 1, 2, 3), bytes(UMP_PART.media, 8, 1, 2)]);
      const { parts, remainder } = readUmp(whole);
      const framing = parts.length * 2;
      const inParts = parts.reduce((sum, found) => sum + found.payload.length, 0);
      expect(framing + inParts + remainder.length).toBe(whole.length);
    });

    it("never copies a payload, so a long media part costs nothing to frame", () => {
      const payload = new Uint8Array(64).fill(3);
      const input = joinBytes([bytes(UMP_PART.media, 64), payload]);
      expect(readUmp(input).parts[0].payload.buffer).toBe(input.buffer);
    });
  });

  describe("regressions", () => {
    it("regression: parts recorded from a real response frame in the order the server sent them", () => {
      const input = joinBytes([
        part(UMP_PART.formatInitializationMetadata, 1),
        part(UMP_PART.sabrRedirect, 2),
        part(UMP_PART.streamProtectionStatus, 3),
        part(UMP_PART.mediaHeader, 4),
        part(UMP_PART.media, 5, 6),
        part(UMP_PART.mediaEnd, 7),
      ]);
      expect(readUmp(input).parts.map(found => found.name)).toEqual([
        "formatInitializationMetadata",
        "sabrRedirect",
        "streamProtectionStatus",
        "mediaHeader",
        "media",
        "mediaEnd",
      ]);
    });
  });
});
