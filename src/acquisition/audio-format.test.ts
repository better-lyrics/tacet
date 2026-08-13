import { describe, expect, it } from "vitest";
import { chooseBestAudioFormat, isAudioFormat } from "@/acquisition/audio-format";

const OPUS_251 = { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160_000, contentLength: "4300517" };
const AAC_140 = { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131_000, contentLength: "3500000" };
const AAC_141 = { itag: 141, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 260_000, contentLength: "7000000" };
const OPUS_774 = { itag: 774, mimeType: 'audio/webm; codecs="opus"', bitrate: 281_000, contentLength: "7600000" };
const VIDEO_243 = { itag: 243, mimeType: 'video/webm; codecs="vp9"', bitrate: 400_000, contentLength: "20000000" };

describe("chooseBestAudioFormat", () => {
  it("takes the highest bitrate audio an entitled account is offered", () => {
    expect(chooseBestAudioFormat([VIDEO_243, AAC_140, AAC_141, OPUS_251, OPUS_774])?.itag).toBe(774);
  });

  it("takes what a free account is offered rather than refusing", () => {
    const chosen = chooseBestAudioFormat([VIDEO_243, OPUS_251]);
    expect(chosen?.itag).toBe(251);
    expect(chosen?.contentLengthBytes).toBe(4_300_517);
  });

  it("never picks a video format, however high its bitrate", () => {
    expect(chooseBestAudioFormat([VIDEO_243, AAC_140])?.itag).toBe(140);
  });

  describe("edge cases", () => {
    it("answers with nothing when there is no audio at all", () => {
      expect(chooseBestAudioFormat([VIDEO_243])).toBeNull();
      expect(chooseBestAudioFormat([])).toBeNull();
    });

    it("answers with nothing for anything that is not a list", () => {
      for (const raw of [undefined, null, "formats", 7, {}]) expect(chooseBestAudioFormat(raw)).toBeNull();
    });

    it("reads a content length that arrived as a string", () => {
      expect(chooseBestAudioFormat([OPUS_251])?.contentLengthBytes).toBe(4_300_517);
    });

    it("keeps a null content length rather than inventing one", () => {
      const chosen = chooseBestAudioFormat([{ itag: 251, mimeType: "audio/webm", bitrate: 160_000 }]);
      expect(chosen?.itag).toBe(251);
      expect(chosen?.contentLengthBytes).toBeNull();
    });

    it("falls back to averageBitrate when bitrate is missing", () => {
      const formats = [
        { itag: 140, mimeType: "audio/mp4", averageBitrate: 131_000 },
        { itag: 141, mimeType: "audio/mp4", averageBitrate: 260_000 },
      ];
      expect(chooseBestAudioFormat(formats)?.itag).toBe(141);
    });

    it("skips a format carrying no itag rather than throwing", () => {
      expect(chooseBestAudioFormat([{ mimeType: "audio/mp4", bitrate: 999_000 }, OPUS_251])?.itag).toBe(251);
    });

    it("breaks a bitrate tie the same way every time", () => {
      const a = { itag: 140, mimeType: "audio/mp4", bitrate: 160_000 };
      const b = { itag: 251, mimeType: "audio/webm", bitrate: 160_000 };
      expect(chooseBestAudioFormat([a, b])?.itag).toBe(251);
      expect(chooseBestAudioFormat([b, a])?.itag).toBe(251);
    });
  });

  describe("invariants", () => {
    it("only ever answers with a format that was in the list", () => {
      const formats = [VIDEO_243, AAC_140, AAC_141, OPUS_251, OPUS_774];
      const chosen = chooseBestAudioFormat(formats);
      expect(formats.map(format => format.itag)).toContain(chosen?.itag);
    });

    it("the answer does not depend on the order it was given", () => {
      const formats = [VIDEO_243, AAC_140, AAC_141, OPUS_251, OPUS_774];
      const forwards = chooseBestAudioFormat(formats)?.itag;
      expect(chooseBestAudioFormat([...formats].reverse())?.itag).toBe(forwards);
    });
  });

  describe("regressions", () => {
    it("regression: a free session gets a usable format instead of nothing", () => {
      expect(chooseBestAudioFormat([OPUS_251])).not.toBeNull();
    });
  });
});

describe("isAudioFormat", () => {
  it("separates audio from video", () => {
    expect(isAudioFormat(OPUS_251)).toBe(true);
    expect(isAudioFormat(VIDEO_243)).toBe(false);
  });

  describe("edge cases", () => {
    it("treats anything unreadable as not audio", () => {
      for (const raw of [null, undefined, {}, 7]) expect(isAudioFormat(raw)).toBe(false);
    });
  });
});
