// -- The ahead track's stems, from chunks to blobs to the page world ----------

import { base64ToBytes } from "@/relay/base64";
import { type ChunkAssembler, createChunkAssembler } from "@/relay/chunk-transfer";

type AheadStem = "vocals" | "instrumental";

interface StagedBlobs {
  vocals: Blob;
  instrumental: Blob;
}

interface Assembly {
  videoId: string;
  vocals: ChunkAssembler | null;
  instrumental: ChunkAssembler | null;
  done: boolean;
}

interface Held extends StagedBlobs {
  videoId: string;
}

// The assemblers used to carry no videoId at all, so chunks belonging to two
// tracks could land in one buffer and be handed over under whichever label the
// last message happened to carry. Keying the assembly means a chunk for another
// track restarts it rather than joining it.
class AheadStaging {
  private assembly: Assembly | null = null;
  private held: Held | null = null;

  get heldVideoId(): string | null {
    return this.held?.videoId ?? null;
  }

  get assemblingVideoId(): string | null {
    return this.assembly?.videoId ?? null;
  }

  clear(): void {
    this.assembly = null;
    this.held = null;
  }

  private assemblyFor(videoId: string): Assembly {
    if (this.assembly === null || this.assembly.videoId !== videoId) {
      this.assembly = { videoId, vocals: null, instrumental: null, done: false };
    }
    return this.assembly;
  }

  addChunk(videoId: string, stem: AheadStem, index: number, total: number, data: string): boolean {
    const assembly = this.assemblyFor(videoId);
    const target =
      stem === "vocals"
        ? (assembly.vocals ??= createChunkAssembler())
        : (assembly.instrumental ??= createChunkAssembler());
    try {
      target.addChunk(index, total, data);
      return true;
    } catch {
      this.assembly = null;
      return false;
    }
  }

  markDone(videoId: string): void {
    this.assemblyFor(videoId).done = true;
  }

  // Answers with the blobs only once, on the transition from assembling to held,
  // so a caller cannot announce the same staged track twice.
  finish(videoId: string): StagedBlobs | null {
    const assembly = this.assembly;
    if (assembly === null || assembly.videoId !== videoId || !assembly.done) return null;
    if (!assembly.vocals?.isComplete() || !assembly.instrumental?.isComplete()) return null;

    const blobs = {
      vocals: new Blob([base64ToBytes(assembly.vocals.assemble())]),
      instrumental: new Blob([base64ToBytes(assembly.instrumental.assemble())]),
    };
    this.assembly = null;
    this.held = { videoId, ...blobs };
    return blobs;
  }

  heldFor(videoId: string): StagedBlobs | null {
    if (this.held === null || this.held.videoId !== videoId) return null;
    return { vocals: this.held.vocals, instrumental: this.held.instrumental };
  }

  releaseHeld(videoId: string): void {
    if (this.held?.videoId === videoId) this.held = null;
  }
}

export { AheadStaging };
export type { AheadStem, StagedBlobs };
