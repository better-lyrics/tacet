import { sourceById } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";

// -- Which source actually delivered a track -------------------------------------

interface DeliveryInput {
  inFlightSource: SourceId | null;
  announcedSource: SourceId | null;
}

function deliveredBy(input: DeliveryInput): SourceId {
  if (input.announcedSource) return input.announcedSource;
  if (input.inFlightSource) return input.inFlightSource;
  return "player-capture";
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

export { deliveredBy, describeDelivery, describeNowArtist };
export type { DeliveryInput };
