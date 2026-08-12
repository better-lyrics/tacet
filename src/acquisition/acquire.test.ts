import { acquireFromMintedUrl, DEFAULT_WINDOW_BYTES } from "@/acquisition/acquire";
import { encodeMessage, messageAt, numberAt, readMessage, textAt } from "@/acquisition/protobuf";
import type { ProtoInput } from "@/acquisition/protobuf";
import type { SabrTransport } from "@/acquisition/sabr-client";
import { UMP_PART, joinBytes } from "@/acquisition/ump";
import { describe, expect, it } from "vitest";

const bytes = (...values: number[]) => new Uint8Array(values);

const mintedUrl = (overrides: Record<string, string | null> = {}) => {
  const url = new URL("https://rr3---sn-i3b7knse.googlevideo.com/videoplayback");
  const params: Record<string, string> = {
    itag: "251",
    mime: "audio/webm",
    clen: "6",
    dur: "188.321",
    lmt: "1763427134620640",
    c: "WEB_REMIX",
    cver: "1.20260804.16.00",
    pot: "MlPxOc4LqNwTV_EFGPApR0tLo264fP84mgqfHYMm",
    range: "0-99",
    rn: "7",
  };
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== null) url.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) url.searchParams.delete(key);
  }
  return url.href;
};

function umpVarint(value: number): number[] {
  if (value < 128) return [value];
  return [0x80 | (value & 0x3f), value >>> 6];
}

const umpPart = (type: number, payload: Uint8Array) =>
  new Uint8Array([...umpVarint(type), ...umpVarint(payload.length), ...payload]);

const header = (headerId: number, startRangeBytes: number): Uint8Array =>
  umpPart(
    UMP_PART.mediaHeader,
    encodeMessage([
      { number: 1, varint: headerId },
      { number: 6, varint: startRangeBytes },
      { number: 9, varint: headerId },
      { number: 12, varint: 5_000 },
    ] satisfies ProtoInput[])
  );

const media = (headerId: number, ...payload: number[]) =>
  umpPart(UMP_PART.media, new Uint8Array([headerId, ...payload]));

function scripted(responses: readonly Uint8Array[]) {
  const sent: { url: string; body: Uint8Array }[] = [];
  const send: SabrTransport = async (url, body) => {
    sent.push({ url, body });
    return { status: 200, bytes: responses[sent.length - 1] ?? new Uint8Array() };
  };
  return { send, sent };
}

const wholeTrack = () => [joinBytes([header(1, 0), media(1, 1, 2, 3, 4, 5, 6)])];

describe("acquireFromMintedUrl", () => {
  it("pulls the track the url describes", async () => {
    const { send } = scripted(wholeTrack());
    const acquired = await acquireFromMintedUrl({ url: mintedUrl(), send });
    expect(acquired.ok).toBe(true);
    expect(acquired.bytes).toEqual(bytes(1, 2, 3, 4, 5, 6));
    expect(acquired.expectedBytes).toBe(6);
    expect(acquired.itag).toBe(251);
  });

  it("reports the mime type the url states, which the decoder needs", async () => {
    const { send } = scripted(wholeTrack());
    expect((await acquireFromMintedUrl({ url: mintedUrl(), send })).mimeType).toBe("audio/webm");
  });

  it("takes the client from the url rather than being told", async () => {
    const { send, sent } = scripted(wholeTrack());
    await acquireFromMintedUrl({ url: mintedUrl(), send });
    const context = messageAt(readMessage(sent[0].body), 19) ?? [];
    const client = messageAt(context, 1) ?? [];
    expect(numberAt(client, 16)).toBe(67);
    expect(textAt(client, 17)).toBe("1.20260804.16.00");
  });

  it("sends the token the url already carries", async () => {
    const { send, sent } = scripted(wholeTrack());
    await acquireFromMintedUrl({ url: mintedUrl(), send });
    const context = messageAt(readMessage(sent[0].body), 19) ?? [];
    expect(context.find(field => field.number === 2)?.bytes?.length).toBeGreaterThan(0);
  });

  it("drops the range and counter the player left on the url and sets its own", async () => {
    const { send, sent } = scripted(wholeTrack());
    await acquireFromMintedUrl({ url: mintedUrl(), send });
    const url = new URL(sent[0].url);
    expect(url.searchParams.get("rn")).toBe("0");
    expect(url.searchParams.get("range")).toBe("0-5");
  });

  it("asks for a window at a time, so a pull cannot run at playback rate", async () => {
    const { send, sent } = scripted([
      joinBytes([header(1, 0), media(1, 1, 2, 3)]),
      joinBytes([header(2, 3), media(2, 4, 5, 6)]),
    ]);
    await acquireFromMintedUrl({ url: mintedUrl(), send, windowBytes: 3 });
    expect(sent.map(request => new URL(request.url).searchParams.get("range"))).toEqual(["0-2", "3-5"]);
  });

  describe("edge cases", () => {
    it("refuses a url that describes no stream, without reaching the network", async () => {
      let called = false;
      const send: SabrTransport = async () => {
        called = true;
        return { status: 200, bytes: new Uint8Array() };
      };
      const acquired = await acquireFromMintedUrl({ url: "https://music.youtube.com/watch?v=abc", send });
      expect(acquired.ok).toBe(false);
      expect(acquired.reason).toContain("does not describe a stream");
      expect(called).toBe(false);
    });

    it("reports a short pull as a failure rather than handing back half a track", async () => {
      const { send } = scripted([joinBytes([header(1, 0), media(1, 1, 2)])]);
      const acquired = await acquireFromMintedUrl({ url: mintedUrl(), send, maxRequests: 1 });
      expect(acquired.ok).toBe(false);
      expect(acquired.bytes).toHaveLength(2);
      expect(acquired.expectedBytes).toBe(6);
    });

    it("falls back to a webm mime type when the url states none", async () => {
      const { send } = scripted(wholeTrack());
      expect((await acquireFromMintedUrl({ url: mintedUrl({ mime: null }), send })).mimeType).toBe("audio/webm");
    });

    it("falls back to the music client when the url names one nobody knows", async () => {
      const { send, sent } = scripted(wholeTrack());
      await acquireFromMintedUrl({ url: mintedUrl({ c: "SOMETHING_NEW" }), send });
      const client = messageAt(messageAt(readMessage(sent[0].body), 19) ?? [], 1) ?? [];
      expect(numberAt(client, 16)).toBe(67);
    });

    it("reports the protection status, which is how a token problem surfaces", async () => {
      const { send } = scripted([
        joinBytes([umpPart(UMP_PART.streamProtectionStatus, encodeMessage([{ number: 1, varint: 3 }]))]),
      ]);
      const acquired = await acquireFromMintedUrl({ url: mintedUrl(), send });
      expect(acquired.protectionStatus).toBe(3);
      expect(acquired.ok).toBe(false);
    });
  });

  describe("invariants", () => {
    it("reports progress against what the url promised", async () => {
      const seen: [number, number][] = [];
      const { send } = scripted(wholeTrack());
      await acquireFromMintedUrl({
        url: mintedUrl(),
        send,
        onProgress: (received, expected) => seen.push([received, expected]),
      });
      expect(seen).toEqual([[6, 6]]);
    });

    it("defaults its window to a megabyte", () => {
      expect(DEFAULT_WINDOW_BYTES).toBe(1_048_576);
    });

    it("never reports ok while short of what the url promised", async () => {
      for (const held of [0, 1, 5]) {
        const payload = Array.from({ length: held }, (_, index) => index + 1);
        const { send } = scripted([joinBytes([header(1, 0), media(1, ...payload)])]);
        const acquired = await acquireFromMintedUrl({ url: mintedUrl(), send, maxRequests: 1 });
        expect(acquired.ok).toBe(false);
      }
    });
  });
});
