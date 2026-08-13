import { rewritePlayerResponse } from "@/capture/shadow-player";
import { describe, expect, it } from "vitest";

const playerResponse = (formats: unknown[]) =>
  JSON.stringify({
    playabilityStatus: { status: "OK" },
    videoDetails: { videoId: "9E3jQcUkXdQ", lengthSeconds: "188" },
    streamingData: { adaptiveFormats: formats },
  });

const audio = (itag: number, bitrate: number, contentLength: string) => ({
  itag,
  mimeType: `audio/mp4; codecs="mp4a.40.2"`,
  bitrate,
  contentLength,
  audioQuality: itag === 141 ? "AUDIO_QUALITY_HIGH" : "AUDIO_QUALITY_MEDIUM",
});

const video = (itag: number) => ({ itag, mimeType: `video/webm; codecs="vp9"`, bitrate: 500_000, contentLength: "9" });

const everyFormat = () => [
  video(243),
  audio(140, 131_000, "3050691"),
  audio(141, 259_000, "6064455"),
  audio(251, 151_000, "3217513"),
  audio(774, 292_000, "7000000"),
];

const formatsOf = (raw: string): { itag: number; mimeType: string }[] =>
  (JSON.parse(raw) as { streamingData: { adaptiveFormats: { itag: number; mimeType: string }[] } }).streamingData
    .adaptiveFormats;

describe("rewritePlayerResponse", () => {
  it("leaves the wanted audio format as the only audio choice", () => {
    const formats = formatsOf(rewritePlayerResponse(playerResponse(everyFormat()), "9E3jQcUkXdQ", 141));
    expect(formats.filter(format => format.mimeType.startsWith("audio")).map(format => format.itag)).toEqual([141]);
  });

  it("drops the other audio rungs the chooser would otherwise prefer", () => {
    const formats = formatsOf(rewritePlayerResponse(playerResponse(everyFormat()), "9E3jQcUkXdQ", 141));
    expect(formats.some(format => format.itag === 251)).toBe(false);
    expect(formats.some(format => format.itag === 140)).toBe(false);
  });

  it("keeps the response readable as a player response", () => {
    const raw = rewritePlayerResponse(playerResponse(everyFormat()), "9E3jQcUkXdQ", 141);
    const parsed = JSON.parse(raw) as { playabilityStatus: { status: string }; videoDetails: { videoId: string } };
    expect(parsed.playabilityStatus.status).toBe("OK");
    expect(parsed.videoDetails.videoId).toBe("9E3jQcUkXdQ");
  });

  describe("edge cases", () => {
    it("leaves the response alone when no format is being forced", () => {
      const raw = playerResponse(everyFormat());
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", null)).toBe(raw);
    });

    it("leaves the response alone when the wanted format is not offered", () => {
      const raw = playerResponse([audio(251, 151_000, "3217513")]);
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", 141)).toBe(raw);
    });

    it("leaves a response that is not json alone", () => {
      expect(rewritePlayerResponse("<html>nope</html>", "9E3jQcUkXdQ", 141)).toBe("<html>nope</html>");
    });

    it("leaves a response carrying no streaming data alone", () => {
      const raw = JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED" } });
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", 141)).toBe(raw);
    });

    it("leaves a response whose formats are not a list alone", () => {
      const raw = JSON.stringify({ streamingData: { adaptiveFormats: "nope" } });
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", 141)).toBe(raw);
    });
  });

  describe("regressions", () => {
    it("regression: keeps the video formats, because a music video with no video stream never fetches at all", () => {
      const formats = formatsOf(rewritePlayerResponse(playerResponse(everyFormat()), "9E3jQcUkXdQ", 141));
      expect(formats.some(format => format.itag === 243)).toBe(true);
    });

    it("regression: a track carrying video still ends up with exactly one audio rung", () => {
      const formats = formatsOf(rewritePlayerResponse(playerResponse(everyFormat()), "9E3jQcUkXdQ", 141));
      expect(formats.filter(format => format.mimeType.startsWith("audio")).map(f => f.itag)).toEqual([141]);
    });

    it("regression: forcing 141 does not fall back to 140, which is what blocking opus produced", () => {
      const formats = formatsOf(rewritePlayerResponse(playerResponse(everyFormat()), "9E3jQcUkXdQ", 141));
      expect(formats.map(format => format.itag)).not.toContain(140);
    });
  });
});
