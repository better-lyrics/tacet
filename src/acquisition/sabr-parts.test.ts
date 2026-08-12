import { encodeMessage } from "@/acquisition/protobuf";
import type { ProtoInput } from "@/acquisition/protobuf";
import {
  readFormatId,
  readFormatInitialization,
  readMediaHeader,
  readNextRequestPolicy,
  readProtectionStatus,
  readSabrError,
  readSabrRedirect,
  splitMediaPayload,
  totalDurationMilliseconds,
} from "@/acquisition/sabr-parts";
import { describe, expect, it } from "vitest";

const bytes = (...values: number[]) => new Uint8Array(values);

const formatId251: ProtoInput[] = [
  { number: 1, varint: 251 },
  { number: 2, varint: 1_763_427_134_620_640n },
];

describe("readFormatId", () => {
  it("reads the itag and the last-modified stamp", () => {
    const format = readFormatId(encodeMessage(formatId251));
    expect(format?.itag).toBe(251);
    expect(format?.lastModified).toBe(1_763_427_134_620_640n);
    expect(format?.xtags).toBeNull();
  });

  it("reads xtags when the format carries them", () => {
    const tagged = encodeMessage([...formatId251, { number: 3, text: "acont=original" }]);
    expect(readFormatId(tagged)?.xtags).toBe("acont=original");
  });

  describe("edge cases", () => {
    it("answers null for an absent payload", () => {
      expect(readFormatId(null)).toBeNull();
    });

    it("answers null when there is no itag, since a format without one names nothing", () => {
      expect(readFormatId(encodeMessage([{ number: 2, varint: 1n }]))).toBeNull();
    });

    it("reads a format whose last-modified stamp is missing as zero rather than refusing it", () => {
      expect(readFormatId(encodeMessage([{ number: 1, varint: 140 }]))?.lastModified).toBe(0n);
    });
  });
});

describe("readMediaHeader", () => {
  const header = encodeMessage([
    { number: 1, varint: 3 },
    { number: 2, text: "9E3jQcUkXdQ" },
    { number: 6, varint: 66_115 },
    { number: 8, varint: 0 },
    { number: 9, varint: 2 },
    { number: 11, varint: 10_000 },
    { number: 12, varint: 5_000 },
    { number: 13, message: formatId251 },
    { number: 14, varint: 132_230 },
  ]);

  it("reads the header id, which is how media parts find their segment", () => {
    expect(readMediaHeader(header).headerId).toBe(3);
  });

  it("reads the byte offset this segment starts at", () => {
    expect(readMediaHeader(header).startRangeBytes).toBe(66_115);
  });

  it("reads the segment's duration and sequence, which drive the next request", () => {
    expect(readMediaHeader(header).durationMilliseconds).toBe(5_000);
    expect(readMediaHeader(header).sequenceNumber).toBe(2);
    expect(readMediaHeader(header).startMilliseconds).toBe(10_000);
  });

  it("reads the format the segment belongs to", () => {
    expect(readMediaHeader(header).formatId?.itag).toBe(251);
  });

  describe("edge cases", () => {
    it("reads a header with nothing but an id, which is what a continuation looks like", () => {
      const sparse = readMediaHeader(encodeMessage([{ number: 1, varint: 7 }]));
      expect(sparse.headerId).toBe(7);
      expect(sparse.startRangeBytes).toBe(0);
      expect(sparse.durationMilliseconds).toBeNull();
      expect(sparse.formatId).toBeNull();
    });

    it("reads header id zero rather than treating it as absent", () => {
      expect(readMediaHeader(encodeMessage([{ number: 1, varint: 0 }])).headerId).toBe(0);
    });

    it("reads the init segment flag", () => {
      expect(readMediaHeader(encodeMessage([{ number: 8, varint: 1 }])).isInitSegment).toBe(true);
      expect(readMediaHeader(encodeMessage([{ number: 8, varint: 0 }])).isInitSegment).toBe(false);
    });
  });
});

describe("readFormatInitialization", () => {
  const metadata = encodeMessage([
    { number: 1, text: "9E3jQcUkXdQ" },
    { number: 2, message: formatId251 },
    { number: 4, varint: 44 },
    { number: 5, text: 'audio/webm; codecs="opus"' },
    { number: 9, varint: 219_000 },
    { number: 10, varint: 1_000 },
  ]);

  it("reads the format, the mime type and the last segment number", () => {
    const read = readFormatInitialization(metadata);
    expect(read.videoId).toBe("9E3jQcUkXdQ");
    expect(read.formatId?.itag).toBe(251);
    expect(read.mimeType).toContain("opus");
    expect(read.endSegmentNumber).toBe(44);
  });

  it("converts the duration from ticks to milliseconds", () => {
    expect(totalDurationMilliseconds(readFormatInitialization(metadata))).toBeCloseTo(219_000, 6);
  });

  describe("edge cases", () => {
    it("answers null for a duration it cannot scale", () => {
      expect(totalDurationMilliseconds(readFormatInitialization(encodeMessage([{ number: 9, varint: 1 }])))).toBeNull();
      expect(
        totalDurationMilliseconds(
          readFormatInitialization(
            encodeMessage([
              { number: 9, varint: 1 },
              { number: 10, varint: 0 },
            ])
          )
        )
      ).toBeNull();
    });

    it("scales a timescale that is not a thousand", () => {
      const ticks = encodeMessage([
        { number: 9, varint: 10_512_000 },
        { number: 10, varint: 48_000 },
      ]);
      expect(totalDurationMilliseconds(readFormatInitialization(ticks))).toBeCloseTo(219_000, 6);
    });
  });
});

describe("readSabrRedirect", () => {
  it("reads the replacement url", () => {
    const payload = encodeMessage([{ number: 1, text: "https://rr9.googlevideo.com/videoplayback?x=1" }]);
    expect(readSabrRedirect(payload)).toBe("https://rr9.googlevideo.com/videoplayback?x=1");
  });

  it("answers null when there is no url, so the caller keeps the one it has", () => {
    expect(readSabrRedirect(encodeMessage([]))).toBeNull();
  });
});

describe("readSabrError", () => {
  it("reads the type and the code", () => {
    const payload = encodeMessage([
      { number: 1, text: "SABR_ERROR_TYPE_UNKNOWN" },
      { number: 2, varint: 5 },
    ]);
    expect(readSabrError(payload)).toEqual({ type: "SABR_ERROR_TYPE_UNKNOWN", code: 5 });
  });

  it("reads an error carrying neither, which still means the request failed", () => {
    expect(readSabrError(encodeMessage([]))).toEqual({ type: null, code: null });
  });
});

describe("readProtectionStatus", () => {
  it("reads the status, where three means an attestation is required", () => {
    expect(readProtectionStatus(encodeMessage([{ number: 1, varint: 1 }]))).toBe(1);
    expect(readProtectionStatus(encodeMessage([{ number: 1, varint: 3 }]))).toBe(3);
  });

  it("answers null when the part carries no status", () => {
    expect(readProtectionStatus(encodeMessage([]))).toBeNull();
  });
});

describe("readNextRequestPolicy", () => {
  it("reads the playback cookie, which the next request has to echo back", () => {
    const cookie = bytes(1, 2, 3, 4, 5);
    const payload = encodeMessage([
      { number: 3, varint: 60_000 },
      { number: 4, varint: 2_000 },
      { number: 7, bytes: cookie },
    ]);
    const policy = readNextRequestPolicy(payload);
    expect(policy.playbackCookie).toEqual(cookie);
    expect(policy.backoffMilliseconds).toBe(2_000);
  });

  describe("regressions", () => {
    it("regression: reads a policy recorded from a real response, which was once read as a protection status", () => {
      const recorded = bytes(
        8,
        189,
        205,
        2,
        16,
        189,
        205,
        2,
        24,
        224,
        212,
        3,
        32,
        208,
        15,
        58,
        21,
        16,
        0,
        66,
        12,
        8,
        251,
        1,
        16,
        224,
        135,
        201,
        255,
        189,
        250,
        144,
        3,
        120,
        1,
        200,
        1,
        6
      );
      const policy = readNextRequestPolicy(recorded);
      expect(policy.backoffMilliseconds).toBe(2_000);
      expect(policy.playbackCookie).toHaveLength(21);
      expect(readFormatId(policy.playbackCookie?.subarray(4, 16) ?? null)?.itag).toBe(251);
    });
  });
});

describe("splitMediaPayload", () => {
  it("separates the header id from the audio, which is not part of the stream", () => {
    const split = splitMediaPayload(bytes(3, 0x1a, 0x45, 0xdf, 0xa3));
    expect(split?.headerId).toBe(3);
    expect(split?.media).toEqual(bytes(0x1a, 0x45, 0xdf, 0xa3));
  });

  describe("edge cases", () => {
    it("answers null for an empty payload", () => {
      expect(splitMediaPayload(bytes())).toBeNull();
    });

    it("reads a media part carrying only its header id as zero audio bytes", () => {
      expect(splitMediaPayload(bytes(9))).toEqual({ headerId: 9, media: bytes() });
    });

    it("reads a header id wide enough to need two bytes", () => {
      const split = splitMediaPayload(bytes(0x80, 0x02, 7, 7));
      expect(split?.headerId).toBe(128);
      expect(split?.media).toEqual(bytes(7, 7));
    });
  });

  describe("invariants", () => {
    it("never copies the audio, so a megabyte part costs nothing to split", () => {
      const payload = new Uint8Array(1024).fill(4);
      expect(splitMediaPayload(payload)?.media.buffer).toBe(payload.buffer);
    });
  });
});
