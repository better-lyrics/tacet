import { base64ToBytes, base64UrlToBytes, bytesToBase64 } from "@/relay/base64";
import { describe, expect, it } from "vitest";

describe("bytesToBase64", () => {
  it("encodes known bytes to their known base64 string", () => {
    expect(bytesToBase64(new TextEncoder().encode("foo"))).toBe("Zm9v");
  });

  it("encodes an empty array to an empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("base64ToBytes", () => {
  it("decodes a known base64 string to its known bytes", () => {
    expect(base64ToBytes("Zm9v")).toEqual(new TextEncoder().encode("foo"));
  });

  it("decodes an empty string to an empty array", () => {
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });
});

describe("round trip", () => {
  it("recovers the original bytes for arbitrary content", () => {
    const bytes = new TextEncoder().encode("the quick brown fox jumps over the lazy dog");
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("recovers every byte value 0 to 255", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  describe("edge cases", () => {
    it("round-trips a single byte", () => {
      const bytes = new Uint8Array([42]);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it("round-trips a buffer large enough to require chunked encoding", () => {
      const bytes = new Uint8Array(500_000);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it("round-trips lengths that are not multiples of 3", () => {
      for (const length of [1, 2, 3, 4, 5, 6, 7, 8191, 8192, 8193]) {
        const bytes = new Uint8Array(length).map((_, i) => (i * 7) % 256);
        expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      }
    });
  });

  describe("invariants", () => {
    it("is deterministic", () => {
      const bytes = new TextEncoder().encode("deterministic");
      expect(bytesToBase64(bytes)).toBe(bytesToBase64(bytes));
    });
  });
});

describe("base64UrlToBytes", () => {
  it("decodes the url alphabet, which is what YouTube's config strings use", () => {
    const bytes = new Uint8Array([255, 239, 190]);
    expect(bytesToBase64(bytes)).toBe("/+++");
    expect(base64UrlToBytes("_---")).toEqual(bytes);
  });

  it("accepts a plain base64 string unchanged, so one function serves both alphabets", () => {
    expect(base64UrlToBytes("Zm9v")).toEqual(new TextEncoder().encode("foo"));
  });

  describe("edge cases", () => {
    it("decodes an empty string", () => {
      expect(base64UrlToBytes("")).toEqual(new Uint8Array(0));
    });

    it("supplies missing padding at every remainder", () => {
      for (const text of ["f", "fo", "foo", "foob", "fooba", "foobar"]) {
        const encoded = bytesToBase64(new TextEncoder().encode(text)).replace(/=+$/, "");
        expect(base64UrlToBytes(encoded)).toEqual(new TextEncoder().encode(text));
      }
    });

    it("accepts a string that already carries its padding", () => {
      expect(base64UrlToBytes("Zg==")).toEqual(new TextEncoder().encode("f"));
    });
  });

  describe("invariants", () => {
    it("recovers every byte value 0 to 255", () => {
      const bytes = new Uint8Array(256).map((_, index) => index);
      const urlSafe = bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(base64UrlToBytes(urlSafe)).toEqual(bytes);
    });
  });
});

describe("the native branch", () => {
  const samples = [
    new Uint8Array(0),
    new Uint8Array([0]),
    new Uint8Array([255, 0, 128]),
    new TextEncoder().encode("the quick brown fox"),
    new Uint8Array(8193).map((_, i) => (i * 31) % 256),
  ];

  it("is used when Uint8Array.prototype.toBase64 exists, and matches the fallback", () => {
    const fallbackResults = samples.map(bytes => bytesToBase64(bytes));
    let calls = 0;

    Uint8Array.prototype.toBase64 = function (this: Uint8Array): string {
      calls++;
      let binary = "";
      for (const byte of this) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    try {
      samples.forEach((bytes, index) => expect(bytesToBase64(bytes)).toBe(fallbackResults[index]));
    } finally {
      Uint8Array.prototype.toBase64 = undefined;
    }

    expect(calls).toBe(samples.length);
  });

  it("is used when Uint8Array.fromBase64 exists, and matches the fallback", () => {
    const encoded = samples.map(bytes => bytesToBase64(bytes));
    let calls = 0;

    Uint8Array.fromBase64 = (base64: string): Uint8Array<ArrayBuffer> => {
      calls++;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    };
    try {
      encoded.forEach((base64, index) => expect(base64ToBytes(base64)).toEqual(samples[index]));
    } finally {
      Uint8Array.fromBase64 = undefined;
    }

    expect(calls).toBe(samples.length);
  });
});
