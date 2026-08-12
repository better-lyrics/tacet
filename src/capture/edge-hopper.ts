interface HopState {
  bufferedEnd: number;
  cursor: number;
  sliceEnd: number;
  trackDuration: number;
  stalls: number;
}

type HopDecision =
  | { action: "done" }
  | { action: "seek"; to: number; cursor: number }
  | { action: "nudge"; to: number }
  | { action: "wait" }
  | { action: "give-up" };

const COMPLETE_EPSILON_S = 0.6;
const ADVANCE_EPSILON_S = 0.3;
const NUDGE_S = 0.1;
const NUDGE_EVERY = 4;
const MAX_STALLS = 70;

const END_GUARD_S = 0.1;

function decideHop(state: HopState): HopDecision {
  const { bufferedEnd, cursor, sliceEnd, trackDuration, stalls } = state;
  const ceiling = Math.max(0, trackDuration - END_GUARD_S);

  if (bufferedEnd >= sliceEnd - COMPLETE_EPSILON_S) return { action: "done" };
  if (stalls >= MAX_STALLS) return { action: "give-up" };

  if (bufferedEnd > cursor + ADVANCE_EPSILON_S) {
    return { action: "seek", to: Math.min(bufferedEnd, ceiling), cursor: bufferedEnd };
  }
  if (stalls > 0 && stalls % NUDGE_EVERY === 0) {
    return { action: "nudge", to: Math.min(cursor + NUDGE_S, ceiling) };
  }
  return { action: "wait" };
}

function bufferedRangeStart(ranges: TimeRanges, at: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= at + 0.5 && ranges.end(i) >= at) return ranges.start(i);
  }
  return at;
}

function bufferedRangeEnd(ranges: TimeRanges, at: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= at + 0.5 && ranges.end(i) >= at) return ranges.end(i);
  }
  return at;
}

export { decideHop, bufferedRangeStart, bufferedRangeEnd, COMPLETE_EPSILON_S, MAX_STALLS };
export type { HopDecision, HopState };
