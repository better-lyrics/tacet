import {
  allAt,
  bytesAt,
  encodeMessage,
  messageAt,
  numberAt,
  readMessage,
  readVarint,
  textAt,
  varintAt,
} from "@/acquisition/protobuf";
import type { ProtoInput } from "@/acquisition/protobuf";
import { describe, expect, it } from "vitest";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("encodeMessage", () => {
  it("writes a single small varint as a tag and a byte", () => {
    expect(encodeMessage([{ number: 1, varint: 251 }])).toEqual(bytes(0x08, 0xfb, 0x01));
  });

  it("writes a multi-byte varint little-endian in groups of seven bits", () => {
    expect(encodeMessage([{ number: 3, varint: 60_000 }])).toEqual(bytes(0x18, 0xe0, 0xd4, 0x03));
  });

  it("writes bytes with a length prefix", () => {
    expect(encodeMessage([{ number: 2, bytes: bytes(0xaa, 0xbb) }])).toEqual(bytes(0x12, 0x02, 0xaa, 0xbb));
  });

  it("writes text as utf-8", () => {
    expect(encodeMessage([{ number: 1, text: "ok" }])).toEqual(bytes(0x0a, 0x02, 0x6f, 0x6b));
  });

  it("writes a nested message as a length-delimited field", () => {
    const encoded = encodeMessage([{ number: 8, message: [{ number: 1, varint: 251 }] }]);
    expect(encoded).toEqual(bytes(0x42, 0x03, 0x08, 0xfb, 0x01));
  });

  it("keeps fields in the order they were given", () => {
    const encoded = encodeMessage([
      { number: 2, varint: 1 },
      { number: 1, varint: 2 },
    ]);
    expect(encoded).toEqual(bytes(0x10, 0x01, 0x08, 0x02));
  });

  describe("edge cases", () => {
    it("writes nothing for a message with no fields", () => {
      expect(encodeMessage([])).toEqual(bytes());
    });

    it("writes zero as one byte rather than omitting the field", () => {
      expect(encodeMessage([{ number: 1, varint: 0 }])).toEqual(bytes(0x08, 0x00));
    });

    it("writes an empty payload as a zero length", () => {
      expect(encodeMessage([{ number: 1, bytes: bytes() }])).toEqual(bytes(0x0a, 0x00));
      expect(encodeMessage([{ number: 1, message: [] }])).toEqual(bytes(0x0a, 0x00));
    });

    it("carries a varint too large for a double, which is what lastModified is", () => {
      const encoded = encodeMessage([{ number: 2, varint: 18_446_744_073_709_551_615n }]);
      expect(varintAt(readMessage(encoded), 2)).toBe(18_446_744_073_709_551_615n);
    });

    it("writes a field number above fifteen with a two-byte tag", () => {
      expect(encodeMessage([{ number: 16, varint: 1 }])).toEqual(bytes(0x80, 0x01, 0x01));
    });

    it("refuses a negative varint rather than encoding it as ten bytes", () => {
      expect(() => encodeMessage([{ number: 1, varint: -1 }])).toThrow(/cannot be negative/);
    });

    it("refuses a fractional varint", () => {
      expect(() => encodeMessage([{ number: 1, varint: 1.5 }])).toThrow(/whole number/);
    });

    it("refuses field number zero, which no wire format can express", () => {
      expect(() => encodeMessage([{ number: 0, varint: 1 }])).toThrow(/field number/);
    });
  });
});

describe("readMessage", () => {
  it("reads a varint field", () => {
    const fields = readMessage(bytes(0x08, 0xfb, 0x01));
    expect(fields).toHaveLength(1);
    expect(fields[0].number).toBe(1);
    expect(fields[0].varint).toBe(251n);
  });

  it("reads a length-delimited field without copying past its end", () => {
    const fields = readMessage(bytes(0x12, 0x02, 0xaa, 0xbb, 0x08, 0x01));
    expect(bytesAt(fields, 2)).toEqual(bytes(0xaa, 0xbb));
    expect(numberAt(fields, 1)).toBe(1);
  });

  it("reads a nested message through messageAt", () => {
    const encoded = encodeMessage([{ number: 8, message: [{ number: 1, varint: 251 }] }]);
    expect(numberAt(messageAt(readMessage(encoded), 8) ?? [], 1)).toBe(251);
  });

  it("reads fixed-width fields as raw bytes", () => {
    const fields = readMessage(bytes(0x0d, 0x01, 0x02, 0x03, 0x04));
    expect(fields[0].wire).toBe(5);
    expect(fields[0].bytes).toEqual(bytes(0x01, 0x02, 0x03, 0x04));
  });

  it("collects a repeated field in order", () => {
    const encoded = encodeMessage([
      { number: 5, varint: 1 },
      { number: 5, varint: 2 },
      { number: 5, varint: 3 },
    ]);
    expect(allAt(readMessage(encoded), 5).map(field => Number(field.varint))).toEqual([1, 2, 3]);
  });

  describe("edge cases", () => {
    it("reads nothing from an empty input", () => {
      expect(readMessage(bytes())).toEqual([]);
    });

    it("answers null for a field that is absent", () => {
      const fields = readMessage(bytes(0x08, 0x01));
      expect(varintAt(fields, 9)).toBeNull();
      expect(bytesAt(fields, 9)).toBeNull();
      expect(messageAt(fields, 9)).toBeNull();
      expect(textAt(fields, 9)).toBeNull();
      expect(numberAt(fields, 9)).toBeNull();
    });

    it("takes the last of a repeated scalar, which is what protobuf specifies", () => {
      const encoded = encodeMessage([
        { number: 1, varint: 1 },
        { number: 1, varint: 2 },
      ]);
      expect(numberAt(readMessage(encoded), 1)).toBe(2);
    });

    it("refuses a length that runs past the end rather than reading short", () => {
      expect(() => readMessage(bytes(0x0a, 0x08, 0x01))).toThrow(/only 1 remain/);
    });

    it("refuses a truncated varint", () => {
      expect(() => readMessage(bytes(0x08, 0x80))).toThrow(/runs past the end/);
    });

    it("refuses a varint longer than ten bytes", () => {
      const runaway = bytes(0x08, ...new Array(11).fill(0x80));
      expect(() => readMessage(runaway)).toThrow(/longer than 10 bytes/);
    });

    it("refuses the deprecated group wire types rather than reading garbage", () => {
      expect(() => readMessage(bytes(0x0b))).toThrow(/wire type 3/);
    });

    it("reads a varint that stops on its first byte", () => {
      expect(readVarint(bytes(0x00), 0)).toEqual({ value: 0n, next: 1 });
    });
  });

  describe("invariants", () => {
    it("round-trips every field kind", () => {
      const original: ProtoInput[] = [
        { number: 1, varint: 0 },
        { number: 2, varint: 1_763_427_134_620_640n },
        { number: 3, bytes: bytes(1, 2, 3, 4, 5) },
        { number: 4, text: "htdemucs" },
        { number: 300, message: [{ number: 1, varint: 251 }] },
      ];
      const fields = readMessage(encodeMessage(original));
      expect(numberAt(fields, 1)).toBe(0);
      expect(varintAt(fields, 2)).toBe(1_763_427_134_620_640n);
      expect(bytesAt(fields, 3)).toEqual(bytes(1, 2, 3, 4, 5));
      expect(textAt(fields, 4)).toBe("htdemucs");
      expect(numberAt(messageAt(fields, 300) ?? [], 1)).toBe(251);
    });

    it("re-encodes what it read byte for byte", () => {
      const original = encodeMessage([
        { number: 1, varint: 60_000 },
        { number: 7, message: [{ number: 8, message: [{ number: 1, varint: 251 }] }] },
      ]);
      const fields = readMessage(original);
      const again = encodeMessage(
        fields.map(field =>
          field.varint !== null
            ? { number: field.number, varint: field.varint }
            : { number: field.number, bytes: field.bytes ?? bytes() }
        )
      );
      expect(again).toEqual(original);
    });

    it("survives a varint at every byte width", () => {
      for (let width = 0; width < 10; width += 1) {
        const value = 1n << BigInt(width * 7);
        expect(varintAt(readMessage(encodeMessage([{ number: 1, varint: value }])), 1)).toBe(value);
      }
    });
  });

  describe("regressions", () => {
    it("regression: decodes a FormatId recorded from a real request", () => {
      const recorded = bytes(0x08, 0xfb, 0x01, 0x10, 0xe0, 0x87, 0xc9, 0xff, 0xbd, 0xfa, 0x90, 0x03);
      const fields = readMessage(recorded);
      expect(numberAt(fields, 1)).toBe(251);
      expect(varintAt(fields, 2)).toBe(1_763_427_134_620_640n);
      expect(
        encodeMessage([
          { number: 1, varint: 251 },
          { number: 2, varint: 1_763_427_134_620_640n },
        ])
      ).toEqual(recorded);
    });

    it("regression: a subarray view is read from its own offset, not the buffer's", () => {
      const backing = bytes(0xff, 0xff, 0x08, 0x2a);
      expect(numberAt(readMessage(backing.subarray(2)), 1)).toBe(42);
    });
  });
});
