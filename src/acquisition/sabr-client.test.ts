import { bytesAt, encodeMessage, messageAt, numberAt, readMessage } from "@/acquisition/protobuf";
import type { ProtoInput } from "@/acquisition/protobuf";
import {
  applyUmpResponse,
  assembleMedia,
  bufferedRangesFor,
  downloadedMilliseconds,
  driveSabr,
  emptyState,
  orderedSegments,
  receivedBytes,
} from "@/acquisition/sabr-client";
import type { SabrTransport } from "@/acquisition/sabr-client";
import type { FormatId } from "@/acquisition/sabr-parts";
import { UMP_PART, joinBytes } from "@/acquisition/ump";
import { describe, expect, it } from "vitest";

const bytes = (...values: number[]) => new Uint8Array(values);

const opus251: FormatId = { itag: 251, lastModified: 1_763_427_134_620_640n, xtags: null };
const formatId251: ProtoInput[] = [
  { number: 1, varint: 251 },
  { number: 2, varint: 1_763_427_134_620_640n },
];

// -- Framing a response the way the server does --------------------------------

function umpVarint(value: number): number[] {
  if (value < 128) return [value];
  if (value < 16_384) return [0x80 | (value & 0x3f), value >>> 6];
  if (value < 2_097_152) return [0xc0 | (value & 0x1f), (value >>> 5) & 0xff, (value >>> 13) & 0xff];
  return [0xe0 | (value & 0x0f), (value >>> 4) & 0xff, (value >>> 12) & 0xff, (value >>> 20) & 0xff];
}

function umpPart(type: number, payload: Uint8Array): Uint8Array {
  return new Uint8Array([...umpVarint(type), ...umpVarint(payload.length), ...payload]);
}

function mediaHeaderPart(options: {
  headerId: number;
  startRangeBytes?: number;
  sequenceNumber?: number;
  durationMilliseconds?: number;
}): Uint8Array {
  return umpPart(
    UMP_PART.mediaHeader,
    encodeMessage([
      { number: 1, varint: options.headerId },
      { number: 6, varint: options.startRangeBytes ?? 0 },
      { number: 9, varint: options.sequenceNumber ?? 1 },
      { number: 12, varint: options.durationMilliseconds ?? 5_000 },
      { number: 13, message: formatId251 },
    ])
  );
}

const mediaPart = (headerId: number, ...media: number[]) =>
  umpPart(UMP_PART.media, new Uint8Array([headerId, ...media]));

const mediaEndPart = (headerId: number) => umpPart(UMP_PART.mediaEnd, new Uint8Array([headerId]));

const formatInitPart = () =>
  umpPart(
    UMP_PART.formatInitializationMetadata,
    encodeMessage([
      { number: 2, message: formatId251 },
      { number: 9, varint: 20_000 },
      { number: 10, varint: 1_000 },
    ])
  );

const nextPolicyPart = (cookie: Uint8Array) =>
  umpPart(UMP_PART.nextRequestPolicy, encodeMessage([{ number: 7, bytes: cookie }]));

const protectionPart = (status: number) =>
  umpPart(UMP_PART.streamProtectionStatus, encodeMessage([{ number: 1, varint: status }]));

const errorPart = (type: string, code: number) =>
  umpPart(
    UMP_PART.sabrError,
    encodeMessage([
      { number: 1, text: type },
      { number: 2, varint: code },
    ])
  );

const redirectPart = (url: string) => umpPart(UMP_PART.sabrRedirect, encodeMessage([{ number: 1, text: url }]));

// -- A transport that answers from a script ------------------------------------

function scriptedTransport(responses: readonly (Uint8Array | { status: number; bytes: Uint8Array })[]) {
  const sent: { url: string; body: Uint8Array }[] = [];
  const send: SabrTransport = async (url, body) => {
    sent.push({ url, body });
    const answer = responses[sent.length - 1];
    if (!answer) return { status: 200, bytes: new Uint8Array() };
    return answer instanceof Uint8Array ? { status: 200, bytes: answer } : answer;
  };
  return { send, sent };
}

const driveInput = (send: SabrTransport, expectedBytes: number, maxRequests = 8) => ({
  serverAbrStreamingUrl: "https://rr3.googlevideo.com/videoplayback?expire=1",
  ustreamerConfig: bytes(1, 2, 3),
  format: opus251,
  expectedBytes,
  clientInfo: { clientName: 67, clientVersion: "1.20260810.00.00", osName: null, osVersion: null },
  poToken: null,
  send,
  maxRequests,
});

describe("applyUmpResponse", () => {
  it("collects media against the header that announced it", () => {
    const state = emptyState();
    const gained = applyUmpResponse(
      state,
      joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 9, 9, 9), mediaEndPart(1)])
    );
    expect(gained.gainedBytes).toBe(3);
    expect(receivedBytes(state)).toBe(3);
    expect(orderedSegments(state)[0].ended).toBe(true);
  });

  it("records that a format was initialised, which unlocks selectedFormatIds", () => {
    const state = emptyState();
    expect(state.formatInitialized).toBe(false);
    applyUmpResponse(state, formatInitPart());
    expect(state.formatInitialized).toBe(true);
  });

  it("keeps the playback cookie the server handed out", () => {
    const state = emptyState();
    applyUmpResponse(state, nextPolicyPart(bytes(4, 5, 6)));
    expect(state.playbackCookie).toEqual(bytes(4, 5, 6));
  });

  it("sums the duration of every segment it holds", () => {
    const state = emptyState();
    applyUmpResponse(
      state,
      joinBytes([
        mediaHeaderPart({ headerId: 1, durationMilliseconds: 5_000 }),
        mediaHeaderPart({ headerId: 2, startRangeBytes: 100, durationMilliseconds: 4_000 }),
      ])
    );
    expect(downloadedMilliseconds(state)).toBe(9_000);
  });

  describe("edge cases", () => {
    it("carries a segment across responses, since a header and its media can be split", () => {
      const state = emptyState();
      applyUmpResponse(state, mediaHeaderPart({ headerId: 1 }));
      expect(receivedBytes(state)).toBe(0);
      applyUmpResponse(state, mediaPart(1, 1, 2, 3, 4));
      expect(receivedBytes(state)).toBe(4);
    });

    it("drops media for a header it never saw rather than inventing a segment", () => {
      const state = emptyState();
      applyUmpResponse(state, mediaPart(7, 1, 2, 3));
      expect(state.segments.size).toBe(0);
      expect(receivedBytes(state)).toBe(0);
    });

    it("ignores a part type it does not act on", () => {
      const state = emptyState();
      applyUmpResponse(
        state,
        joinBytes([umpPart(UMP_PART.snackbarMessage, bytes(1, 2)), mediaHeaderPart({ headerId: 1 })])
      );
      expect(state.segments.size).toBe(1);
    });

    it("reports zero gain for a response carrying no media", () => {
      const state = emptyState();
      expect(applyUmpResponse(state, protectionPart(1)).gainedBytes).toBe(0);
    });

    it("takes the later header when one id is announced twice", () => {
      const state = emptyState();
      applyUmpResponse(state, mediaHeaderPart({ headerId: 1, durationMilliseconds: 5_000 }));
      applyUmpResponse(state, joinBytes([mediaHeaderPart({ headerId: 1, durationMilliseconds: 6_000 })]));
      expect(state.segments.size).toBe(1);
      expect(downloadedMilliseconds(state)).toBe(6_000);
    });
  });

  describe("invariants", () => {
    it("assembles media in byte order however the segments arrived", () => {
      const state = emptyState();
      applyUmpResponse(state, joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 3 }), mediaPart(2, 4, 5, 6)]));
      applyUmpResponse(state, joinBytes([mediaHeaderPart({ headerId: 1, startRangeBytes: 0 }), mediaPart(1, 1, 2, 3)]));
      expect(assembleMedia(state)).toEqual(bytes(1, 2, 3, 4, 5, 6));
    });

    it("assembles nothing from a state that received nothing", () => {
      expect(assembleMedia(emptyState())).toEqual(bytes());
    });
  });
});

describe("bufferedRangesFor", () => {
  it("describes nothing until something has been downloaded", () => {
    expect(bufferedRangesFor(emptyState(), opus251)).toEqual([]);
  });

  it("describes one range from the start covering everything held", () => {
    const state = emptyState();
    applyUmpResponse(
      state,
      joinBytes([
        mediaHeaderPart({ headerId: 1, sequenceNumber: 1, durationMilliseconds: 5_000 }),
        mediaHeaderPart({ headerId: 2, startRangeBytes: 10, sequenceNumber: 2, durationMilliseconds: 5_000 }),
      ])
    );
    expect(bufferedRangesFor(state, opus251)).toEqual([
      {
        formatId: opus251,
        startMilliseconds: 0,
        durationMilliseconds: 10_000,
        startSegmentIndex: 1,
        endSegmentIndex: 2,
      },
    ]);
  });
});

describe("driveSabr", () => {
  it("pulls a whole track across several responses", async () => {
    const { send, sent } = scriptedTransport([
      joinBytes([formatInitPart(), mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1, 2, 3), mediaEndPart(1)]),
      joinBytes([
        mediaHeaderPart({ headerId: 2, startRangeBytes: 3, sequenceNumber: 2 }),
        mediaPart(2, 4, 5, 6),
        mediaEndPart(2),
      ]),
    ]);
    const result = await driveSabr(driveInput(send, 6));
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("the whole track arrived");
    expect(result.media).toEqual(bytes(1, 2, 3, 4, 5, 6));
    expect(sent).toHaveLength(2);
  });

  it("counts its requests in the query string, starting at zero", async () => {
    const { send, sent } = scriptedTransport([
      joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
      joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2)]),
    ]);
    await driveSabr(driveInput(send, 2));
    expect(sent.map(request => new URL(request.url).searchParams.get("rn"))).toEqual(["0", "1"]);
  });

  it("withholds selectedFormatIds until the server initialises a format", async () => {
    const { send, sent } = scriptedTransport([
      joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
      joinBytes([formatInitPart(), mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2)]),
      joinBytes([mediaHeaderPart({ headerId: 3, startRangeBytes: 2 }), mediaPart(3, 3)]),
    ]);
    await driveSabr(driveInput(send, 3));
    const selected = sent.map(request => messageAt(readMessage(request.body), 2));
    expect(selected[0]).toBeNull();
    expect(selected[1]).toBeNull();
    expect(numberAt(selected[2] ?? [], 1)).toBe(251);
  });

  it("echoes the playback cookie back on the next request", async () => {
    const { send, sent } = scriptedTransport([
      joinBytes([nextPolicyPart(bytes(7, 7, 7)), mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
      joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2)]),
    ]);
    await driveSabr(driveInput(send, 2));
    const context = (index: number) => messageAt(readMessage(sent[index].body), 19) ?? [];
    expect(bytesAt(context(0), 3)).toBeNull();
    expect(bytesAt(context(1), 3)).toEqual(bytes(7, 7, 7));
  });

  it("advances the player time by what it has downloaded", async () => {
    const { send, sent } = scriptedTransport([
      joinBytes([mediaHeaderPart({ headerId: 1, durationMilliseconds: 7_000 }), mediaPart(1, 1)]),
      joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2)]),
    ]);
    await driveSabr(driveInput(send, 2));
    const playerTime = (index: number) => numberAt(messageAt(readMessage(sent[index].body), 1) ?? [], 28);
    expect(playerTime(0)).toBe(0);
    expect(playerTime(1)).toBe(7_000);
  });

  it("follows a redirect and asks the replacement host instead", async () => {
    const { send, sent } = scriptedTransport([
      redirectPart("https://rr9.googlevideo.com/videoplayback?expire=2"),
      joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1, 2)]),
    ]);
    const result = await driveSabr(driveInput(send, 2));
    expect(result.ok).toBe(true);
    expect(new URL(sent[0].url).host).toBe("rr3.googlevideo.com");
    expect(new URL(sent[1].url).host).toBe("rr9.googlevideo.com");
  });

  describe("edge cases", () => {
    it("stops on a sabr error and says which one", async () => {
      const { send } = scriptedTransport([errorPart("SABR_ERROR_TYPE_UNKNOWN", 5)]);
      const result = await driveSabr(driveInput(send, 100));
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("SABR_ERROR_TYPE_UNKNOWN");
      expect(result.sabrError).toEqual({ type: "SABR_ERROR_TYPE_UNKNOWN", code: 5 });
    });

    it("stops when the server requires an attestation, which is the answer about tokens", async () => {
      const { send } = scriptedTransport([protectionPart(3)]);
      const result = await driveSabr(driveInput(send, 100));
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("attestation");
      expect(result.protectionStatus).toBe(3);
    });

    it("keeps going while an attestation is only pending", async () => {
      const { send, sent } = scriptedTransport([
        joinBytes([protectionPart(2), mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
        joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2)]),
      ]);
      const result = await driveSabr(driveInput(send, 2));
      expect(result.ok).toBe(true);
      expect(sent).toHaveLength(2);
    });

    it("stops when the server asks for a fresh player response", async () => {
      const { send } = scriptedTransport([umpPart(UMP_PART.reloadPlayerResponse, bytes())]);
      const result = await driveSabr(driveInput(send, 100));
      expect(result.reason).toContain("fresh player response");
    });

    it("stops after two responses in a row carry no media", async () => {
      const { send, sent } = scriptedTransport([
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
        protectionPart(1),
        protectionPart(1),
        protectionPart(1),
      ]);
      const result = await driveSabr(driveInput(send, 100));
      expect(result.reason).toBe("the server stopped sending media");
      expect(sent).toHaveLength(3);
    });

    it("forgives a single empty response between two that carry media", async () => {
      const { send } = scriptedTransport([
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
        protectionPart(1),
        joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2)]),
      ]);
      const result = await driveSabr(driveInput(send, 2));
      expect(result.ok).toBe(true);
    });

    it("stops on a status that is not 200", async () => {
      const { send } = scriptedTransport([{ status: 403, bytes: new Uint8Array() }]);
      const result = await driveSabr(driveInput(send, 100));
      expect(result.reason).toBe("the server answered 403");
    });

    it("stops at the request budget rather than looping for ever", async () => {
      const send: SabrTransport = async () => ({
        status: 200,
        bytes: joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
      });
      const result = await driveSabr(driveInput(send, 1_000_000, 3));
      expect(result.requests).toBe(3);
      expect(result.reason).toBe("the request budget ran out");
      expect(result.ok).toBe(false);
    });

    it("stops on the end of the track even short of the expected bytes", async () => {
      const { send } = scriptedTransport([
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1), umpPart(UMP_PART.endOfTrack, bytes())]),
      ]);
      const result = await driveSabr(driveInput(send, 100));
      expect(result.reason).toBe("the server reported the end of the track");
      expect(result.ok).toBe(false);
    });
  });

  describe("invariants", () => {
    it("reports progress as bytes received, never as bytes asked for", async () => {
      const seen: number[] = [];
      const { send } = scriptedTransport([
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1, 2)]),
        joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 2 }), mediaPart(2, 3)]),
      ]);
      await driveSabr({ ...driveInput(send, 3), onProgress: received => seen.push(received) });
      expect(seen).toEqual([2, 3]);
    });

    it("never reports ok while short of the expected bytes", async () => {
      const { send } = scriptedTransport([joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)])]);
      const result = await driveSabr(driveInput(send, 100, 1));
      expect(result.ok).toBe(false);
      expect(result.receivedBytes).toBe(1);
    });

    it("sends the ustreamer config on every request, not only the first", async () => {
      const { send, sent } = scriptedTransport([
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
        joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2)]),
      ]);
      await driveSabr(driveInput(send, 2));
      for (const request of sent) expect(bytesAt(readMessage(request.body), 5)).toEqual(bytes(1, 2, 3));
    });
  });

  describe("the byte window", () => {
    it("asks for one window at a time when given a size", async () => {
      const { send, sent } = scriptedTransport([
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1, 2)]),
        joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 2 }), mediaPart(2, 3, 4)]),
      ]);
      await driveSabr({ ...driveInput(send, 4), windowBytes: 2 });
      expect(sent.map(request => new URL(request.url).searchParams.get("range"))).toEqual(["0-1", "2-3"]);
    });

    it("never asks past the end of the track", async () => {
      const { send, sent } = scriptedTransport([joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1, 2, 3)])]);
      await driveSabr({ ...driveInput(send, 3), windowBytes: 1_000_000 });
      expect(new URL(sent[0].url).searchParams.get("range")).toBe("0-2");
    });

    it("asks for no range at all when given no size, which is what lets the server pace it", async () => {
      const { send, sent } = scriptedTransport([joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)])]);
      await driveSabr(driveInput(send, 1));
      expect(new URL(sent[0].url).searchParams.has("range")).toBe(false);
    });

    it("advances the window by what arrived, never by what was asked for", async () => {
      const { send, sent } = scriptedTransport([
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
        joinBytes([mediaHeaderPart({ headerId: 2, startRangeBytes: 1 }), mediaPart(2, 2, 3)]),
      ]);
      await driveSabr({ ...driveInput(send, 3), windowBytes: 2 });
      expect(sent.map(request => new URL(request.url).searchParams.get("range"))).toEqual(["0-1", "1-2"]);
    });
  });

  describe("regressions", () => {
    it("regression: a redirect does not count as a response that carried no media", async () => {
      const { send, sent } = scriptedTransport([
        redirectPart("https://rr9.googlevideo.com/videoplayback?expire=2"),
        redirectPart("https://rr8.googlevideo.com/videoplayback?expire=3"),
        joinBytes([mediaHeaderPart({ headerId: 1 }), mediaPart(1, 1)]),
      ]);
      const result = await driveSabr(driveInput(send, 1));
      expect(result.ok).toBe(true);
      expect(sent).toHaveLength(3);
    });
  });
});
