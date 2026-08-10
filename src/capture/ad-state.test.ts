import { isAdPlaying } from "@/capture/ad-state";
import { describe, expect, it } from "vitest";

function fakeDocument(options: { barAttributes?: string[] | null; playerClasses?: string[] | null } = {}): Document {
  const { barAttributes = [], playerClasses = [] } = options;
  const playerBar = barAttributes && {
    hasAttribute: (name: string) => barAttributes.includes(name),
  };
  const moviePlayer = playerClasses && {
    classList: { contains: (token: string) => playerClasses.includes(token) },
  };

  return {
    querySelector: (selector: string) => (selector === "ytmusic-player-bar" ? playerBar : null),
    getElementById: (id: string) => (id === "movie_player" ? moviePlayer : null),
  } as unknown as Document;
}

describe("isAdPlaying", () => {
  it("is false during a track", () => {
    expect(isAdPlaying(fakeDocument())).toBe(false);
  });

  it("is true on the player bar's is-advertisement attribute", () => {
    expect(isAdPlaying(fakeDocument({ barAttributes: ["is-advertisement"] }))).toBe(true);
  });

  it("is true on the movie player's ad classes", () => {
    expect(isAdPlaying(fakeDocument({ playerClasses: ["ad-showing"] }))).toBe(true);
    expect(isAdPlaying(fakeDocument({ playerClasses: ["ad-interrupting"] }))).toBe(true);
  });

  describe("regressions", () => {
    it("regression: a player id disagreeing with the url is not an ad", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: [] }))).toBe(false);
    });

    it("regression: ad-showing as a player bar attribute is still not a signal", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: ["ad-showing", "player-page-open"] }))).toBe(false);
    });

    it("regression: the hidden worker frame never sets is-advertisement, so the classes have to stand alone", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: [], playerClasses: ["ad-showing", "ad-interrupting"] }))).toBe(
        true
      );
    });

    it("regression: the classes clear the moment the track starts", () => {
      expect(
        isAdPlaying(fakeDocument({ barAttributes: [], playerClasses: ["playing-mode", "ytp-hide-controls"] }))
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("is false before the bar has mounted", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: null }))).toBe(false);
    });

    it("is false before the movie player has mounted", () => {
      expect(isAdPlaying(fakeDocument({ playerClasses: null }))).toBe(false);
    });

    it("is false when neither has mounted", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: null, playerClasses: null }))).toBe(false);
    });
  });

  describe("invariants", () => {
    it("either signal alone is enough, since each has been seen without the other", () => {
      const barOnly = fakeDocument({ barAttributes: ["is-advertisement"], playerClasses: [] });
      const classOnly = fakeDocument({ barAttributes: [], playerClasses: ["ad-showing"] });
      const both = fakeDocument({ barAttributes: ["is-advertisement"], playerClasses: ["ad-showing"] });
      for (const doc of [barOnly, classOnly, both]) expect(isAdPlaying(doc)).toBe(true);
    });
  });
});
