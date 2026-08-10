import { MOVIE_PLAYER_ELEMENT_ID, PLAYER_BAR_SELECTOR, moviePlayerShowsAd, playerBarShowsAd } from "@/capture/ad-guard";

function isAdPlaying(doc: Document): boolean {
  return (
    playerBarShowsAd(doc.querySelector(PLAYER_BAR_SELECTOR)) ||
    moviePlayerShowsAd(doc.getElementById(MOVIE_PLAYER_ELEMENT_ID))
  );
}

export { isAdPlaying };
