const OFFSET_TOLERANCE_S = 2;

type PositionSource = "player" | "element";

type StemStart = { kind: "start"; offsetSeconds: number; source: PositionSource } | { kind: "bypass"; reason: string };

interface StemStartInput {
  playerTimeSeconds: number;
  elementTimeSeconds: number;
  stemDurationSeconds: number;
  deckTrackId: string | null;
  playerTrackId: string | null;
}

function usable(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function resolveStemStart(input: StemStartInput): StemStart {
  const { playerTimeSeconds, elementTimeSeconds, stemDurationSeconds, deckTrackId, playerTrackId } = input;

  // Every path that starts a deck comes through here, and none of the clocks
  // below say anything about *which* track is in the buffer. Without this a
  // deck left holding the previous track is restarted at the current track's
  // playhead, which plays the wrong song perfectly cleanly. A null on either
  // side is "unknown", never "mismatched": refusing on unknown would hand the
  // listener back to the unseparated track every time the player is between
  // tracks.
  if (deckTrackId !== null && playerTrackId !== null && deckTrackId !== playerTrackId) {
    return { kind: "bypass", reason: `the deck holds ${deckTrackId} and the player is on ${playerTrackId}` };
  }

  if (!Number.isFinite(stemDurationSeconds) || stemDurationSeconds <= 0) {
    return { kind: "bypass", reason: "the stems have no duration" };
  }

  const source: PositionSource | null = usable(playerTimeSeconds)
    ? "player"
    : usable(elementTimeSeconds)
      ? "element"
      : null;
  if (source === null) return { kind: "bypass", reason: "neither clock gave a usable position" };

  const position = source === "player" ? playerTimeSeconds : elementTimeSeconds;
  if (position > stemDurationSeconds + OFFSET_TOLERANCE_S) {
    return {
      kind: "bypass",
      reason: `position ${position.toFixed(1)}s is past ${stemDurationSeconds.toFixed(1)}s of stems`,
    };
  }

  return { kind: "start", offsetSeconds: Math.min(position, stemDurationSeconds), source };
}

export { OFFSET_TOLERANCE_S, resolveStemStart };
export type { PositionSource, StemStart, StemStartInput };
