import {
  MOVIE_PLAYER_AD_CLASSES,
  PLAYER_BAR_AD_ATTRIBUTE,
  PLAYER_BAR_SELECTOR,
  moviePlayerShowsAd,
  playerBarShowsAd,
} from "@/capture/ad-guard";
import { describe, expect, it } from "vitest";

function elementWithAttributes(attributes: string[]): { hasAttribute(name: string): boolean } {
  return { hasAttribute: name => attributes.includes(name) };
}

function elementWithClasses(classes: string[]): { classList: { contains(token: string): boolean } } {
  return { classList: { contains: token => classes.includes(token) } };
}

describe("playerBarShowsAd", () => {
  it("is true when the player bar is marked as an advertisement", () => {
    expect(playerBarShowsAd(elementWithAttributes([PLAYER_BAR_AD_ATTRIBUTE]))).toBe(true);
  });

  it("is false during a track", () => {
    expect(playerBarShowsAd(elementWithAttributes(["player-page-open"]))).toBe(false);
  });

  describe("edge cases", () => {
    it("is false before the bar has mounted", () => {
      expect(playerBarShowsAd(null)).toBe(false);
    });
  });

  describe("regressions", () => {
    it("regression: reads the same bar and attribute Better Lyrics reads", () => {
      expect(PLAYER_BAR_SELECTOR).toBe("ytmusic-player-bar");
      expect(PLAYER_BAR_AD_ATTRIBUTE).toBe("is-advertisement");
    });

    it("regression: a player id that disagrees with the url is not an ad signal", () => {
      expect(playerBarShowsAd(elementWithAttributes([]))).toBe(false);
    });
  });
});

describe("moviePlayerShowsAd", () => {
  it("is true for either class the player carries during an ad", () => {
    expect(moviePlayerShowsAd(elementWithClasses(["ad-showing"]))).toBe(true);
    expect(moviePlayerShowsAd(elementWithClasses(["ad-interrupting"]))).toBe(true);
    expect(moviePlayerShowsAd(elementWithClasses(["ad-showing", "ad-interrupting"]))).toBe(true);
  });

  it("is false during a track", () => {
    expect(moviePlayerShowsAd(elementWithClasses(["playing-mode", "ytp-hide-controls"]))).toBe(false);
  });

  describe("edge cases", () => {
    it("is false before the player has mounted", () => {
      expect(moviePlayerShowsAd(null)).toBe(false);
    });

    it("is false with no classes at all", () => {
      expect(moviePlayerShowsAd(elementWithClasses([]))).toBe(false);
    });
  });

  describe("regressions", () => {
    it("regression: ytp-ad-playing is not one of them, it never appeared in either sample", () => {
      expect(MOVIE_PLAYER_AD_CLASSES).not.toContain("ytp-ad-playing");
      expect(moviePlayerShowsAd(elementWithClasses(["ytp-ad-playing"]))).toBe(false);
    });

    it("regression: a substring of an ad class does not count", () => {
      expect(moviePlayerShowsAd(elementWithClasses(["ad", "showing", "ad-showing-overlay"]))).toBe(false);
    });
  });
});
