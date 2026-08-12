// -- When our audio must stand down and let the original play -----------------

type StandDown = { kind: "ad" } | { kind: "speed"; rate: number };

interface StandDownInput {
  adPlaying: boolean;
  playbackRate: number;
}

function standDownReason(input: StandDownInput): StandDown | null {
  if (input.adPlaying) return { kind: "ad" };
  if (input.playbackRate !== 1) return { kind: "speed", rate: input.playbackRate };
  return null;
}

function describeStandDown(reason: StandDown): string {
  if (reason.kind === "ad") return "an ad is playing";
  return `the listener set the speed to ${reason.rate}x, which stems cannot follow without shifting pitch`;
}

export { describeStandDown, standDownReason };
export type { StandDown, StandDownInput };
