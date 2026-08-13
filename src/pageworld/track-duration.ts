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

// `getDuration()` cannot corroborate the bar, because during a gapless append it
// is wrong in both directions and the fade sits in the worst of them. Measured
// live across one advance: the bar held 289 for the whole track while
// getDuration climbed 289.0, 290.6, 296.7, 304.9 as the next track appended, and
// on the track after it read 29.9, 49.9, 59.9, 79.8 against a steady bar of 134.
// A symmetric tolerance refuses both, and a one-sided one still refuses the tail,
// which is precisely where a fade is armed and waiting.
//
// What separates the one case this guard exists for is not size but movement.
// The bar still timing an ad the attribute has released reads its total as the
// ad's and then changes it when the real track starts, measured as 0:13, 0:14,
// 0:46, then 3:57. A bar describing the track it is on does not move. So the
// question is whether the bar's own total has settled, and the player's clock is
// not consulted at all.
const CLOCK_SETTLE_MS = 3000;

interface ClockSettling {
  seconds: number;
  changedAtMs: number;
}

function noteClockDuration(previous: ClockSettling | null, seconds: number, nowMs: number): ClockSettling | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (previous === null || previous.seconds !== seconds) return { seconds, changedAtMs: nowMs };
  return previous;
}

function clockDurationSettled(settling: ClockSettling | null, nowMs: number): boolean {
  if (settling === null) return false;
  return nowMs - settling.changedAtMs >= CLOCK_SETTLE_MS;
}

export {
  CLOCK_SETTLE_MS,
  PLAYER_BAR_CLOCK_SELECTOR,
  chooseTrackDuration,
  clockDurationSettled,
  noteClockDuration,
  parseClockDuration,
  readClockDuration,
};
export type { ClockSettling };
