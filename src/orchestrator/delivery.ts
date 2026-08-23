import { sourceById } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";

// -- Which source actually delivered a track -------------------------------------

interface DeliveryInput {
  known: SourceId | null;
  inFlightSource: SourceId | null;
  announcedSource: SourceId | null;
}

function deliveredBy(input: DeliveryInput): SourceId {
  if (input.announcedSource) return input.announcedSource;
  if (input.inFlightSource) return input.inFlightSource;
  return input.known ?? "player-capture";
}

// -- What each track in flight was fetched by ------------------------------------

const DELIVERY_LOG_CAPACITY = 8;

class DeliveryLog {
  private readonly sources = new Map<string, SourceId>();

  note(videoId: string, input: Omit<DeliveryInput, "known">): void {
    const source = deliveredBy({ ...input, known: this.sources.get(videoId) ?? null });
    this.sources.delete(videoId);
    this.sources.set(videoId, source);
    while (this.sources.size > DELIVERY_LOG_CAPACITY) {
      const oldest = this.sources.keys().next();
      if (oldest.done === true) break;
      this.sources.delete(oldest.value);
    }
  }

  sourceOf(videoId: string): SourceId | null {
    return this.sources.get(videoId) ?? null;
  }

  clear(): void {
    this.sources.clear();
  }
}

function describeDelivery(source: SourceId | null): string | null {
  return source ? sourceById(source).label : null;
}

// -- The one line the popup shows under a track ----------------------------------

function describeNowArtist(artist: string, delivery: string | null): string {
  const trimmed = artist.trim();
  if (!delivery) return trimmed;
  const via = `via ${delivery}`;
  return trimmed ? `${trimmed} · ${via}` : via;
}

export { DELIVERY_LOG_CAPACITY, DeliveryLog, deliveredBy, describeDelivery, describeNowArtist };
export type { DeliveryInput };
