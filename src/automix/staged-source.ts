// -- Which source is worth holding for the next fade -------------------------

import type { StagedState } from "@/automix/transition-cue";

type StagedKind = "stems" | "mix";

interface HeldSource {
  videoId: string;
  kind: StagedKind;
  state: StagedState;
}

interface OfferedSource {
  videoId: string;
  kind: StagedKind;
}

interface StagedSourceInput {
  held: HeldSource | null;
  offered: OfferedSource;
  remainingSeconds: number;
  fadeSeconds: number;
  decodeLeadSeconds: number;
}

type StagedSourceChoice = { kind: "take" } | { kind: "keep"; reason: string };

function usable(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function decideStagedSource(input: StagedSourceInput): StagedSourceChoice {
  const { held, offered, remainingSeconds, fadeSeconds, decodeLeadSeconds } = input;

  if (held === null) return { kind: "take" };
  if (held.videoId !== offered.videoId) return { kind: "take" };

  if (held.kind === "stems" && offered.kind === "mix") {
    return { kind: "keep", reason: `${offered.videoId} is already staged as stems, a mix would be a downgrade` };
  }

  if (held.state === "none") return { kind: "take" };

  if (held.kind === offered.kind) {
    return { kind: "keep", reason: `${offered.videoId} is already staged as ${held.kind}` };
  }

  if (!usable(remainingSeconds) || !usable(decodeLeadSeconds) || !usable(fadeSeconds) || fadeSeconds <= 0) {
    return {
      kind: "keep",
      reason: `the clock reads ${remainingSeconds} s against a ${fadeSeconds} s fade, so the staged mix stands`,
    };
  }

  if (remainingSeconds <= fadeSeconds + decodeLeadSeconds) {
    return {
      kind: "keep",
      reason: `${remainingSeconds.toFixed(1)} s left is too late to decode stems over the staged mix`,
    };
  }

  return { kind: "take" };
}

// -- When a track may be armed to fade at all --------------------------------

function mayArmStaging(remainingSeconds: number, fadeSeconds: number, decodeLeadSeconds: number): boolean {
  if (!usable(remainingSeconds) || !usable(fadeSeconds) || fadeSeconds <= 0) return false;
  const lead = usable(decodeLeadSeconds) ? decodeLeadSeconds : 0;
  return remainingSeconds <= fadeSeconds + lead;
}

// -- When what is staged stops being worth holding ---------------------------

interface SpentStagingInput {
  stagedVideoId: string | null;
  nextTrackVideoId: string | null;
  listenerVideoId: string | null;
}

function isStagingSpent(input: SpentStagingInput): boolean {
  const { stagedVideoId, nextTrackVideoId, listenerVideoId } = input;
  if (stagedVideoId === null) return false;
  if (listenerVideoId !== null && stagedVideoId === listenerVideoId) return true;
  return nextTrackVideoId !== null && stagedVideoId !== nextTrackVideoId;
}

export { decideStagedSource, isStagingSpent, mayArmStaging };
export type { HeldSource, OfferedSource, SpentStagingInput, StagedKind, StagedSourceChoice, StagedSourceInput };
