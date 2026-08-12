// -- How much of the track is left -------------------------------------------

interface CueClockInput {
  trackDurationSeconds: number;
  trackPositionSeconds: number;
  deckDurationSeconds: number;
  deckPositionSeconds: number;
}

function usable(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function remainingIn(durationSeconds: number, positionSeconds: number): number {
  if (!usable(durationSeconds) || durationSeconds <= 0) return Number.NaN;
  if (!usable(positionSeconds)) return Number.NaN;
  return Math.max(0, durationSeconds - positionSeconds);
}

function remainingForCue(input: CueClockInput): number {
  const inTrack = remainingIn(input.trackDurationSeconds, input.trackPositionSeconds);
  if (!Number.isNaN(inTrack)) return inTrack;
  return remainingIn(input.deckDurationSeconds, input.deckPositionSeconds);
}

function fadeCeilingSeconds(input: CueClockInput): number {
  return remainingIn(input.deckDurationSeconds, input.deckPositionSeconds);
}

export { fadeCeilingSeconds, remainingForCue };
export type { CueClockInput };
