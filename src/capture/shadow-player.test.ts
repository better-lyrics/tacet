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

const entitled = () => [
  video(243),
  audio(140, 131_000, "3050691"),
  audio(141, 259_000, "6064455"),
  audio(251, 151_000, "3217513"),
  audio(774, 292_000, "7000000"),
];

const freeAccount = () => [video(243), audio(251, 151_000, "3217513")];

const formatsOf = (raw: string): { itag: number; mimeType: string }[] =>
  (JSON.parse(raw) as { streamingData: { adaptiveFormats: { itag: number; mimeType: string }[] } }).streamingData
    .adaptiveFormats;

const audioItags = (raw: string): number[] =>
  formatsOf(raw)
    .filter(format => format.mimeType.startsWith("audio"))
    .map(format => format.itag);

describe("rewritePlayerResponse", () => {
  it("leaves the best audio the session is offered as the only audio choice", () => {
    expect(audioItags(rewritePlayerResponse(playerResponse(entitled()), "9E3jQcUkXdQ", true))).toEqual([774]);
  });

  it("drops the other audio rungs the player's own chooser would prefer", () => {
    const formats = formatsOf(rewritePlayerResponse(playerResponse(entitled()), "9E3jQcUkXdQ", true));
    expect(formats.some(format => format.itag === 251)).toBe(false);
    expect(formats.some(format => format.itag === 140)).toBe(false);
  });

  it("keeps the response readable as a player response", () => {
    const raw = rewritePlayerResponse(playerResponse(entitled()), "9E3jQcUkXdQ", true);
    const parsed = JSON.parse(raw) as { playabilityStatus: { status: string }; videoDetails: { videoId: string } };
    expect(parsed.playabilityStatus.status).toBe("OK");
    expect(parsed.videoDetails.videoId).toBe("9E3jQcUkXdQ");
  });

  describe("edge cases", () => {
    it("leaves the response alone when this mint is not ours", () => {
      const raw = playerResponse(entitled());
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", false)).toBe(raw);
    });

    it("leaves a response alone when it offers no audio at all", () => {
      const raw = playerResponse([video(243)]);
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", true)).toBe(raw);
    });

    it("leaves a response that is not json alone", () => {
      expect(rewritePlayerResponse("<html>nope</html>", "9E3jQcUkXdQ", true)).toBe("<html>nope</html>");
    });

    it("leaves a response carrying no streaming data alone", () => {
      const raw = JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED" } });
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", true)).toBe(raw);
    });

    it("leaves a response whose formats are not a list alone", () => {
      const raw = JSON.stringify({ streamingData: { adaptiveFormats: "nope" } });
      expect(rewritePlayerResponse(raw, "9E3jQcUkXdQ", true)).toBe(raw);
    });
  });

  describe("invariants", () => {
    it("always leaves exactly one audio format when it rewrites at all", () => {
      for (const formats of [entitled(), freeAccount()]) {
        expect(audioItags(rewritePlayerResponse(playerResponse(formats), "9E3jQcUkXdQ", true))).toHaveLength(1);
      }
    });
  });

  describe("regressions", () => {
    it("regression: keeps the video formats, because a music video with no video stream never fetches at all", () => {
      const formats = formatsOf(rewritePlayerResponse(playerResponse(entitled()), "9E3jQcUkXdQ", true));
      expect(formats.some(format => format.itag === 243)).toBe(true);
    });

    it("regression: a free session keeps its own best format rather than being left with none", () => {
      expect(audioItags(rewritePlayerResponse(playerResponse(freeAccount()), "9E3jQcUkXdQ", true))).toEqual([251]);
    });

    it("regression: demanding a hardcoded 141 rejected every url a free session could ever mint", () => {
      const raw = rewritePlayerResponse(playerResponse(freeAccount()), "9E3jQcUkXdQ", true);
      expect(audioItags(raw)).not.toEqual([141]);
      expect(audioItags(raw)).toEqual([251]);
    });
  });
});
