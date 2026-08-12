import { describe, expect, it } from "vitest";
import { describeAbrRequest, diffAbrRequests } from "@/acquisition/observed-request";
import { encodeMessage } from "@/acquisition/protobuf";
import { buildAbrRequest } from "@/acquisition/sabr-request";

const OPUS_251 = { itag: 251, lastModified: 1_763_427_134_620_640n, xtags: null };

const CLIENT_INFO = { clientName: 67, clientVersion: "1.20260810.00.00", osName: null, osVersion: null };

function ourRequest(overrides: Partial<Parameters<typeof buildAbrRequest>[0]> = {}): Uint8Array {
  return buildAbrRequest({
    format: OPUS_251,
    ustreamerConfig: null,
    playerTimeMilliseconds: 0,
    bufferedRanges: [],
    formatInitialized: false,
    poToken: null,
    playbackCookie: null,
    clientInfo: CLIENT_INFO,
    ...overrides,
  });
}

describe("describeAbrRequest", () => {
  it("reads back a request this codebase built", () => {
    const described = describeAbrRequest(ourRequest());
    expect(described.ok).toBe(true);
    expect(described.topLevel.map(field => field.number)).toEqual([1, 16, 19]);
  });

  it("names the sections a reader cares about", () => {
    const described = describeAbrRequest(
      ourRequest({
        ustreamerConfig: new Uint8Array([1, 2, 3, 4, 5]),
        poToken: new Uint8Array(110),
        playbackCookie: new Uint8Array(24),
      })
    );
    expect(described.ustreamerConfigBytes).toBe(5);
    expect(described.poTokenBytes).toBe(110);
    expect(described.playbackCookieBytes).toBe(24);
    expect(described.clientInfo.map(field => field.number)).toEqual([16, 17]);
  });

  it("counts buffered ranges rather than flattening them", () => {
    const ranges = [
      {
        formatId: OPUS_251,
        startMilliseconds: 0,
        durationMilliseconds: 5000,
        startSegmentIndex: 1,
        endSegmentIndex: 2,
      },
      {
        formatId: OPUS_251,
        startMilliseconds: 5000,
        durationMilliseconds: 5000,
        startSegmentIndex: 3,
        endSegmentIndex: 4,
      },
    ];
    expect(describeAbrRequest(ourRequest({ bufferedRanges: ranges })).bufferedRangeCount).toBe(2);
  });

  describe("edge cases", () => {
    it("refuses an empty body rather than claiming it decoded", () => {
      const described = describeAbrRequest(new Uint8Array());
      expect(described.ok).toBe(false);
      expect(described.totalBytes).toBe(0);
    });

    it("refuses bytes that are not a protobuf rather than throwing", () => {
      const described = describeAbrRequest(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
      expect(described.ok).toBe(false);
      expect(described.reason.length).toBeGreaterThan(0);
    });

    it("survives a message carrying fields it has never heard of", () => {
      const body = encodeMessage([
        { number: 1, message: [{ number: 28, varint: 1234 }] },
        { number: 999, varint: 7 },
      ]);
      const described = describeAbrRequest(body);
      expect(described.ok).toBe(true);
      expect(described.topLevel.map(field => field.number)).toContain(999);
    });
  });
});

describe("diffAbrRequests", () => {
  it("finds nothing between a request and itself", () => {
    const described = describeAbrRequest(ourRequest());
    expect(diffAbrRequests(described, described)).toEqual([]);
  });

  it("reports a field one request carries and the other does not", () => {
    const theirs = describeAbrRequest(ourRequest({ ustreamerConfig: new Uint8Array([1, 2, 3]) }));
    const ours = describeAbrRequest(ourRequest());
    const differences = diffAbrRequests(theirs, ours);
    const config = differences.find(difference => difference.where === "request" && difference.number === 5);
    expect(config).toEqual({ where: "request", number: 5, theirs: "3 bytes", ours: null });
  });

  it("reports a differing value inside the client abr state", () => {
    const theirs = describeAbrRequest(ourRequest({ playerTimeMilliseconds: 5000 }));
    const ours = describeAbrRequest(ourRequest({ playerTimeMilliseconds: 0 }));
    const differences = diffAbrRequests(theirs, ours);
    expect(differences).toContainEqual({ where: "clientAbrState", number: 28, theirs: "5000", ours: "0" });
  });

  describe("invariants", () => {
    it("is symmetric in what it notices, only swapping the sides", () => {
      const a = describeAbrRequest(ourRequest({ poToken: new Uint8Array(8) }));
      const b = describeAbrRequest(ourRequest());
      const forward = diffAbrRequests(a, b);
      const backward = diffAbrRequests(b, a);
      expect(forward).toHaveLength(backward.length);
      expect(forward[0].theirs).toBe(backward[0].ours);
    });
  });
});
