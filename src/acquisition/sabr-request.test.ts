import { bytesAt, messageAt, numberAt, readMessage, textAt, varintAt } from "@/acquisition/protobuf";
import type { ProtoField } from "@/acquisition/protobuf";
import type { FormatId } from "@/acquisition/sabr-parts";
import { buildAbrRequest, sabrRequestUrl, withByteRange } from "@/acquisition/sabr-request";
import type { AbrRequestInput } from "@/acquisition/sabr-request";
import { describe, expect, it } from "vitest";

const opus251: FormatId = { itag: 251, lastModified: 1_763_427_134_620_640n, xtags: null };

const baseInput: AbrRequestInput = {
  format: opus251,
  ustreamerConfig: new Uint8Array([1, 2, 3, 4]),
  playerTimeMilliseconds: 0,
  bufferedRanges: [],
  formatInitialized: false,
  poToken: null,
  playbackCookie: null,
  clientInfo: { clientName: 67, clientVersion: "1.20260810.00.00", osName: null, osVersion: null },
};

const decode = (input: AbrRequestInput): ProtoField[] => readMessage(buildAbrRequest(input));

const repeated = (fields: ProtoField[], number: number) =>
  fields.filter(field => field.number === number).map(field => readMessage(field.bytes ?? new Uint8Array()));

describe("buildAbrRequest", () => {
  it("puts the player time and the audio-only track type in clientAbrState", () => {
    const state = messageAt(decode({ ...baseInput, playerTimeMilliseconds: 12_345 }), 1) ?? [];
    expect(numberAt(state, 28)).toBe(12_345);
    expect(numberAt(state, 40)).toBe(1);
  });

  it("carries the ustreamer config verbatim in field 5", () => {
    const config = new Uint8Array([9, 8, 7, 6, 5]);
    expect(bytesAt(decode({ ...baseInput, ustreamerConfig: config }), 5)).toEqual(config);
  });

  it("always asks for the format it wants through preferredAudioFormatIds", () => {
    const preferred = messageAt(decode(baseInput), 16) ?? [];
    expect(numberAt(preferred, 1)).toBe(251);
    expect(varintAt(preferred, 2)).toBe(1_763_427_134_620_640n);
  });

  it("names the client inside streamerContext", () => {
    const context = messageAt(decode(baseInput), 19) ?? [];
    const client = messageAt(context, 1) ?? [];
    expect(numberAt(client, 16)).toBe(67);
    expect(textAt(client, 17)).toBe("1.20260810.00.00");
  });

  it("sends no selectedFormatIds until the server has initialised a format", () => {
    expect(messageAt(decode(baseInput), 2)).toBeNull();
    expect(messageAt(decode({ ...baseInput, formatInitialized: true }), 2)).not.toBeNull();
  });

  it("writes one bufferedRanges entry per range, in order", () => {
    const ranges = repeated(
      decode({
        ...baseInput,
        bufferedRanges: [
          {
            formatId: opus251,
            startMilliseconds: 0,
            durationMilliseconds: 10_000,
            startSegmentIndex: 1,
            endSegmentIndex: 2,
          },
          {
            formatId: opus251,
            startMilliseconds: 10_000,
            durationMilliseconds: 5_000,
            startSegmentIndex: 3,
            endSegmentIndex: 3,
          },
        ],
      }),
      3
    );
    expect(ranges).toHaveLength(2);
    expect(numberAt(ranges[0], 2)).toBe(0);
    expect(numberAt(ranges[0], 3)).toBe(10_000);
    expect(numberAt(ranges[0], 5)).toBe(2);
    expect(numberAt(ranges[1], 2)).toBe(10_000);
    expect(numberAt(messageAt(ranges[1], 1) ?? [], 1)).toBe(251);
  });

  describe("edge cases", () => {
    it("omits the ustreamer config when there is none, so a minted url can be driven without one", () => {
      expect(bytesAt(decode({ ...baseInput, ustreamerConfig: null }), 5)).toBeNull();
    });

    it("omits the token and the cookie when there are none, rather than sending empty bytes", () => {
      const context = messageAt(decode(baseInput), 19) ?? [];
      expect(bytesAt(context, 2)).toBeNull();
      expect(bytesAt(context, 3)).toBeNull();
    });

    it("carries the token and the cookie verbatim when there are some", () => {
      const poToken = new Uint8Array([1, 1, 2, 3, 5]);
      const playbackCookie = new Uint8Array([8, 13, 21]);
      const context = messageAt(decode({ ...baseInput, poToken, playbackCookie }), 19) ?? [];
      expect(bytesAt(context, 2)).toEqual(poToken);
      expect(bytesAt(context, 3)).toEqual(playbackCookie);
    });

    it("omits xtags when the format has none and sends it when it does", () => {
      expect(textAt(messageAt(decode(baseInput), 16) ?? [], 3)).toBeNull();
      const tagged = { ...opus251, xtags: "acont=original" };
      expect(textAt(messageAt(decode({ ...baseInput, format: tagged }), 16) ?? [], 3)).toBe("acont=original");
    });

    it("omits the operating system when it is unknown", () => {
      const client = messageAt(messageAt(decode(baseInput), 19) ?? [], 1) ?? [];
      expect(textAt(client, 18)).toBeNull();
      const named = { ...baseInput.clientInfo, osName: "Macintosh", osVersion: "10_15_7" };
      const withOs = messageAt(messageAt(decode({ ...baseInput, clientInfo: named }), 19) ?? [], 1) ?? [];
      expect(textAt(withOs, 18)).toBe("Macintosh");
      expect(textAt(withOs, 19)).toBe("10_15_7");
    });

    it("rounds a fractional player time rather than refusing to encode it", () => {
      const state = messageAt(decode({ ...baseInput, playerTimeMilliseconds: 7_999.6 }), 1) ?? [];
      expect(numberAt(state, 28)).toBe(8_000);
    });

    it("clamps a negative player time to zero, which a varint cannot express", () => {
      const state = messageAt(decode({ ...baseInput, playerTimeMilliseconds: -5 }), 1) ?? [];
      expect(numberAt(state, 28)).toBe(0);
    });
  });

  describe("invariants", () => {
    it("writes fields in ascending number order, which is what the player does", () => {
      const numbers = decode({
        ...baseInput,
        formatInitialized: true,
        bufferedRanges: [
          {
            formatId: opus251,
            startMilliseconds: 0,
            durationMilliseconds: 1,
            startSegmentIndex: 1,
            endSegmentIndex: 1,
          },
        ],
      }).map(field => field.number);
      expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
      expect(numbers).toEqual([1, 2, 3, 5, 16, 19]);
    });

    it("is deterministic for the same input", () => {
      expect(buildAbrRequest(baseInput)).toEqual(buildAbrRequest(baseInput));
    });

    it("never mutates the config it was handed", () => {
      const config = new Uint8Array([1, 2, 3]);
      buildAbrRequest({ ...baseInput, ustreamerConfig: config });
      expect(config).toEqual(new Uint8Array([1, 2, 3]));
    });
  });
});

describe("sabrRequestUrl", () => {
  it("sets the request number in the query string, where the counter lives", () => {
    expect(sabrRequestUrl("https://rr3.googlevideo.com/videoplayback?expire=1", 4)).toBe(
      "https://rr3.googlevideo.com/videoplayback?expire=1&rn=4"
    );
  });

  it("replaces a request number the url already carries rather than adding a second", () => {
    const url = sabrRequestUrl("https://rr3.googlevideo.com/videoplayback?rn=0&ump=1", 9);
    expect(new URL(url).searchParams.getAll("rn")).toEqual(["9"]);
    expect(new URL(url).searchParams.get("ump")).toBe("1");
  });

  describe("edge cases", () => {
    it("starts at zero", () => {
      expect(new URL(sabrRequestUrl("https://rr3.googlevideo.com/videoplayback", 0)).searchParams.get("rn")).toBe("0");
    });

    it("keeps every other parameter untouched", () => {
      const base = "https://rr3.googlevideo.com/videoplayback?expire=1786564176&ei=abc&pot=xyz&sabr=1";
      const url = new URL(sabrRequestUrl(base, 2));
      expect(url.searchParams.get("expire")).toBe("1786564176");
      expect(url.searchParams.get("pot")).toBe("xyz");
      expect(url.searchParams.get("sabr")).toBe("1");
    });
  });
});

describe("withByteRange", () => {
  it("asks for an inclusive window, as an http range is", () => {
    const url = new URL(withByteRange("https://rr3.googlevideo.com/videoplayback?itag=251", 0, 1_048_575));
    expect(url.searchParams.get("range")).toBe("0-1048575");
  });

  it("replaces a range the url already carries rather than adding a second", () => {
    const url = new URL(withByteRange("https://rr3.googlevideo.com/videoplayback?range=0-99", 100, 199));
    expect(url.searchParams.getAll("range")).toEqual(["100-199"]);
  });

  describe("edge cases", () => {
    it("asks for a single byte", () => {
      expect(new URL(withByteRange("https://rr3.googlevideo.com/v", 5, 5)).searchParams.get("range")).toBe("5-5");
    });

    it("clamps a negative start rather than sending a malformed range", () => {
      expect(new URL(withByteRange("https://rr3.googlevideo.com/v", -10, 99)).searchParams.get("range")).toBe("0-99");
    });

    it("rounds a fractional boundary down", () => {
      expect(new URL(withByteRange("https://rr3.googlevideo.com/v", 0.9, 99.9)).searchParams.get("range")).toBe("0-99");
    });

    it("keeps every other parameter untouched", () => {
      const url = new URL(withByteRange("https://rr3.googlevideo.com/v?itag=251&pot=xyz&rn=3", 0, 9));
      expect(url.searchParams.get("itag")).toBe("251");
      expect(url.searchParams.get("pot")).toBe("xyz");
      expect(url.searchParams.get("rn")).toBe("3");
    });
  });
});
