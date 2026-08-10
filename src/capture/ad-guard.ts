const MOVIE_PLAYER_ELEMENT_ID = "movie_player";
const PLAYER_BAR_SELECTOR = "ytmusic-player-bar";
const PLAYER_BAR_AD_ATTRIBUTE = "is-advertisement";
const MOVIE_PLAYER_AD_CLASSES = ["ad-showing", "ad-interrupting"];

interface ElementWithAttributes {
  hasAttribute(name: string): boolean;
}

interface ElementWithClasses {
  classList: { contains(token: string): boolean };
}

function playerBarShowsAd(playerBar: ElementWithAttributes | null): boolean {
  return playerBar?.hasAttribute(PLAYER_BAR_AD_ATTRIBUTE) ?? false;
}

function moviePlayerShowsAd(player: ElementWithClasses | null): boolean {
  if (!player) return false;
  return MOVIE_PLAYER_AD_CLASSES.some(name => player.classList.contains(name));
}

export {
  MOVIE_PLAYER_AD_CLASSES,
  MOVIE_PLAYER_ELEMENT_ID,
  PLAYER_BAR_SELECTOR,
  PLAYER_BAR_AD_ATTRIBUTE,
  moviePlayerShowsAd,
  playerBarShowsAd,
};
export type { ElementWithAttributes, ElementWithClasses };
