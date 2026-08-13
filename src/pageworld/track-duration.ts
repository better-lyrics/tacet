const PLAYER_BAR_CLOCK_SELECTOR = "ytmusic-player-bar .time-info";
const CLOCK_PATTERN = /(?:(\d+):)?(\d+):([0-5]\d)\s*\/\s*(?:(\d+):)?(\d+):([0-5]\d)/;

function toSeconds(hours: string | undefined, minutes: string, seconds: string): number {
  return (hours ? Number(hours) * 3600 : 0) + Number(minutes) * 60 + Number(seconds);
}

function parseClockDuration(text: string): number {
  const match = CLOCK_PATTERN.exec(text.trim());
  if (!match) return Number.NaN;
  const total = toSeconds(match[4], match[5], match[6]);
  return total > 0 ? total : Number.NaN;
}

function readClockDuration(doc: Document): number {
  const node = doc.querySelector(PLAYER_BAR_CLOCK_SELECTOR);
  return node ? parseClockDuration(node.textContent ?? "") : Number.NaN;
}

function chooseTrackDuration(clockSeconds: number, playerSeconds: number): number {
  if (Number.isFinite(clockSeconds) && clockSeconds > 0) return clockSeconds;
  return Number.isFinite(playerSeconds) && playerSeconds > 0 ? playerSeconds : 0;
}

// -- Whether that length is certain enough to fade on --------------------------

const CLOCK_AGREEMENT_TOLERANCE_S = 5;

// One-sided, for the same reason `settledTrackDuration` is: the two ways these
// clocks disagree are told apart by their direction, and only one of them means
// the bar is lying. A bar *shorter* than the player is a bar still timing an ad
// the attribute has already released, which is what this guard exists for. A
// bar *longer* than the player is a gapless append, where `getDuration()` is
// reporting the buffered length and the bar is the authority, so refusing there
// silenced the cue for the whole track and no fade could ever arm.
function clocksAgree(clockSeconds: number, playerSeconds: number): boolean {
  if (!Number.isFinite(clockSeconds) || clockSeconds <= 0) return false;
  if (!Number.isFinite(playerSeconds) || playerSeconds <= 0) return false;
  return clockSeconds + CLOCK_AGREEMENT_TOLERANCE_S >= playerSeconds;
}

export {
  CLOCK_AGREEMENT_TOLERANCE_S,
  PLAYER_BAR_CLOCK_SELECTOR,
  chooseTrackDuration,
  clocksAgree,
  parseClockDuration,
  readClockDuration,
};
