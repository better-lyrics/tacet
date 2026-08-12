import { audioFormatsIn, chooseAudioFormat, readSabrParameters } from "@/acquisition/player-response";
import type { AudioFormat } from "@/acquisition/player-response";
import { describe, expect, it } from "vitest";

const opus251 = {
  itag: 251,
  mimeType: 'audio/webm; codecs="opus"',
  bitrate: 141_236,
  averageBitrate: 134_178,
  audioSampleRate: "48000",
  audioChannels: 2,
  contentLength: "3696065",
  approxDurationMs: "219341",
  lastModified: "1763427134620640",
  loudnessDb: 3.09,
};

const aac140 = {
  itag: 140,
  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
  bitrate: 130_308,
  audioSampleRate: "44100",
  contentLength: "3552918",
  approxDurationMs: "219406",
  lastModified: "1763427100000000",
};

const playerResponse = (overrides: Record<string, unknown> = {}) => ({
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "9E3jQcUkXdQ", lengthSeconds: "219" },
  streamingData: {
    serverAbrStreamingUrl: "https://rr3.googlevideo.com/videoplayback?expire=1786564176",
    adaptiveFormats: [aac140, opus251, { itag: 137, mimeType: 'video/mp4; codecs="avc1"', contentLength: "1" }],
  },
  playerConfig: {
    mediaCommonConfig: { mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: "Zm9v" } },
  },
  ...overrides,
});

const ok = (response: unknown) => {
  const result = readSabrParameters(response);
  if (!result.ok) throw new Error(`expected parameters, got ${result.reason}`);
  return result.parameters;
};

describe("audioFormatsIn", () => {
  it("reads only the audio formats", () => {
    expect(audioFormatsIn(playerResponse()).map(format => format.itag)).toEqual([140, 251]);
  });

  it("parses the string-typed numbers InnerTube sends", () => {
    const format = audioFormatsIn(playerResponse())[1];
    expect(format.contentLengthBytes).toBe(3_696_065);
    expect(format.sampleRateHz).toBe(48_000);
    expect(format.durationMilliseconds).toBe(219_341);
    expect(format.lastModified).toBe(1_763_427_134_620_640n);
  });

  describe("edge cases", () => {
    it("reads nothing from a response with no streamingData", () => {
      expect(audioFormatsIn({})).toEqual([]);
      expect(audioFormatsIn(null)).toEqual([]);
      expect(audioFormatsIn({ streamingData: { adaptiveFormats: "not an array" } })).toEqual([]);
    });

    it("drops a format missing the fields a request needs", () => {
      const missing = { streamingData: { adaptiveFormats: [{ mimeType: "audio/webm", itag: 251 }] } };
      expect(audioFormatsIn(missing)).toEqual([]);
    });

    it("reads xtags when a format carries them", () => {
      const tagged = { streamingData: { adaptiveFormats: [{ ...opus251, xtags: "acont=original" }] } };
      expect(audioFormatsIn(tagged)[0].xtags).toBe("acont=original");
    });
  });
});

describe("chooseAudioFormat", () => {
  const formats = audioFormatsIn(playerResponse());

  it("takes the highest bitrate", () => {
    expect(chooseAudioFormat(formats)?.itag).toBe(251);
  });

  it("answers null when there is nothing to choose", () => {
    expect(chooseAudioFormat([])).toBeNull();
  });

  describe("edge cases", () => {
    it("prefers a plain format over a louder DRC one, so our audio matches vanilla", () => {
      const drc: AudioFormat = { ...formats[1], itag: 774, bitrateBitsPerSecond: 200_000, isDrc: true };
      expect(chooseAudioFormat([...formats, drc])?.itag).toBe(251);
    });

    it("falls back to a DRC format when it is the only one", () => {
      const drc: AudioFormat = { ...formats[1], itag: 774, isDrc: true };
      expect(chooseAudioFormat([drc])?.itag).toBe(774);
    });

    it("ignores a format whose length is unknown, since there is nothing to ask for", () => {
      const empty: AudioFormat = { ...formats[1], itag: 999, bitrateBitsPerSecond: 999_999, contentLengthBytes: 0 };
      expect(chooseAudioFormat([...formats, empty])?.itag).toBe(251);
    });
  });

  describe("invariants", () => {
    it("does not depend on the order it is given", () => {
      expect(chooseAudioFormat([...formats].reverse())?.itag).toBe(chooseAudioFormat(formats)?.itag);
    });

    it("breaks a bitrate tie the same way every time", () => {
      const tie: AudioFormat = { ...formats[1], itag: 250 };
      expect(chooseAudioFormat([formats[1], tie])?.itag).toBe(250);
      expect(chooseAudioFormat([tie, formats[1]])?.itag).toBe(250);
    });
  });
});

describe("readSabrParameters", () => {
  it("reads everything a request needs from one response", () => {
    const parameters = ok(playerResponse());
    expect(parameters.videoId).toBe("9E3jQcUkXdQ");
    expect(parameters.trackDurationSeconds).toBe(219);
    expect(parameters.serverAbrStreamingUrl).toContain("googlevideo.com");
    expect(parameters.format.itag).toBe(251);
    expect(parameters.ustreamerConfig).toEqual(new TextEncoder().encode("foo"));
  });

  it("decodes a config written in the url alphabet", () => {
    const response = playerResponse({
      playerConfig: {
        mediaCommonConfig: { mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: "_---" } },
      },
    });
    expect(ok(response).ustreamerConfig).toEqual(new Uint8Array([255, 239, 190]));
  });

  describe("edge cases", () => {
    it("refuses a response the player itself could not play, and says the status", () => {
      const blocked = playerResponse({ playabilityStatus: { status: "LOGIN_REQUIRED" } });
      expect(readSabrParameters(blocked)).toEqual({ ok: false, reason: "playability status is LOGIN_REQUIRED" });
    });

    it("refuses a response carrying no abr url, which is what a non-SABR stream looks like", () => {
      const response = playerResponse();
      response.streamingData.serverAbrStreamingUrl = "";
      expect(readSabrParameters(response).ok).toBe(false);
    });

    it("refuses a response carrying no ustreamer config, which the request cannot be built without", () => {
      const response = playerResponse({ playerConfig: {} });
      const result = readSabrParameters(response);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain("videoPlaybackUstreamerConfig");
    });

    it("refuses a response with no usable audio and counts what it saw", () => {
      const response = playerResponse();
      response.streamingData.adaptiveFormats = [];
      const result = readSabrParameters(response);
      expect(result.ok === false && result.reason).toBe("none of the 0 audio formats is usable");
    });

    it("refuses a response naming no videoId", () => {
      expect(readSabrParameters(playerResponse({ videoDetails: {} })).ok).toBe(false);
    });

    it("refuses nonsense rather than throwing", () => {
      for (const nonsense of [null, undefined, 7, "text", [], {}]) {
        expect(readSabrParameters(nonsense).ok).toBe(false);
      }
    });

    it("accepts a response that states no playability status at all", () => {
      const response = playerResponse({});
      const withoutStatus = { ...response, playabilityStatus: {} };
      expect(readSabrParameters(withoutStatus).ok).toBe(true);
    });

    it("reads a track whose length is missing as zero rather than refusing it", () => {
      expect(ok(playerResponse({ videoDetails: { videoId: "abc" } })).trackDurationSeconds).toBe(0);
    });
  });

  describe("invariants", () => {
    it("never reports ok without every field a request needs", () => {
      const parameters = ok(playerResponse());
      expect(parameters.ustreamerConfig.length).toBeGreaterThan(0);
      expect(parameters.serverAbrStreamingUrl.length).toBeGreaterThan(0);
      expect(parameters.format.contentLengthBytes).toBeGreaterThan(0);
      expect(parameters.format.lastModified).toBeGreaterThan(0n);
    });
  });
});
