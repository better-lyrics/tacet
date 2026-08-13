// -- What is held ready to fade into next -------------------------------------

import { isStagingSpent } from "@/automix/staged-source";
import type { HeldSource, StagedKind } from "@/automix/staged-source";
import type { StagedState } from "@/automix/transition-cue";

interface StagedStems {
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

interface MixBuffer {
  duration: number;
}

type StagedAudio<Mix> = { kind: "stems"; stems: StagedStems } | { kind: "mix"; mix: Mix };

interface Held<Mix> {
  videoId: string;
  kind: StagedKind;
  state: Exclude<StagedState, "none">;
  stems: StagedStems | null;
  mix: Mix | null;
}

const REMEMBERED_UNAVAILABLE = 8;

// Five variables that had to move together, mutated from six places, is what let
// a track stay armed to fade for a whole song. Holding them as one value makes
// the illegal combinations unrepresentable: nothing is staged unless a videoId
// is staged with it, and nothing reaches "ready" without the audio to play.
class Staging<Mix extends MixBuffer = AudioBuffer> {
  private held: Held<Mix> | null = null;
  private readonly mixUnavailable = new Set<string>();

  get videoId(): string | null {
    return this.held?.videoId ?? null;
  }

  get state(): StagedState {
    return this.held?.state ?? "none";
  }

  get kind(): StagedKind {
    return this.held?.kind ?? "stems";
  }

  source(): HeldSource | null {
    if (this.held === null) return null;
    return { videoId: this.held.videoId, kind: this.held.kind, state: this.held.state };
  }

  clear(): void {
    this.held = null;
  }

  // -- Stems, which arrive encoded and are decoded on the cue's demand --------

  offerStems(videoId: string): void {
    this.held = { videoId, kind: "stems", state: "encoded", stems: null, mix: null };
  }

  beginStemsDecode(): string | null {
    if (this.held === null || this.held.kind !== "stems") return null;
    this.held = { ...this.held, state: "decoding" };
    return this.held.videoId;
  }

  takeStems(videoId: string, stems: StagedStems): boolean {
    if (this.held === null || this.held.videoId !== videoId || this.held.kind !== "stems") return false;
    this.held = { ...this.held, state: "ready", stems, mix: null };
    return true;
  }

  // -- A mix, which is the unseparated capture and the only route with
  //    separation switched off ------------------------------------------------

  beginMix(videoId: string): void {
    this.held = { videoId, kind: "mix", state: "decoding", stems: null, mix: null };
  }

  takeMix(videoId: string, mix: Mix): boolean {
    if (this.held === null || this.held.videoId !== videoId || this.held.kind !== "mix") return false;
    this.held = { ...this.held, state: "ready", stems: null, mix };
    return true;
  }

  abandonMix(videoId: string): boolean {
    if (this.held === null || this.held.videoId !== videoId || this.held.kind !== "mix") return false;
    if (this.held.state === "ready") return false;
    this.held = null;
    this.markMixUnavailable(videoId);
    return true;
  }

  markMixUnavailable(videoId: string): void {
    this.mixUnavailable.add(videoId);
    while (this.mixUnavailable.size > REMEMBERED_UNAVAILABLE) {
      const oldest = this.mixUnavailable.values().next().value;
      if (oldest === undefined) return;
      this.mixUnavailable.delete(oldest);
    }
  }

  forgetMixUnavailable(videoId: string): void {
    this.mixUnavailable.delete(videoId);
  }

  mixIsUnavailable(videoId: string): boolean {
    return this.mixUnavailable.has(videoId);
  }

  // -- What the graph is handed ----------------------------------------------

  audio(videoId: string): (StagedAudio<Mix> & { durationSeconds: number }) | null {
    const held = this.held;
    if (held === null || held.videoId !== videoId) return null;
    if (held.kind === "mix") {
      if (held.mix === null) return null;
      return { kind: "mix", mix: held.mix, durationSeconds: held.mix.duration };
    }
    if (held.stems === null) return null;
    const frames = held.stems.vocals[0]?.length ?? 0;
    return { kind: "stems", stems: held.stems, durationSeconds: frames / held.stems.sampleRate };
  }

  releaseIfSpent(nextTrackVideoId: string | null, listenerVideoId: string | null): boolean {
    if (!isStagingSpent({ stagedVideoId: this.videoId, nextTrackVideoId, listenerVideoId })) return false;
    this.clear();
    return true;
  }

  describe(): { videoId: string | null; state: StagedState; kind: StagedKind; durationSeconds: number | null } {
    return {
      videoId: this.videoId,
      state: this.state,
      kind: this.kind,
      durationSeconds: this.videoId === null ? null : this.audio(this.videoId)?.durationSeconds ?? null,
    };
  }
}

export { Staging };
export type { MixBuffer, StagedAudio, StagedStems };
