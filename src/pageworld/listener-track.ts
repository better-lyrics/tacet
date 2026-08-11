// -- Which track the listener is on ------------------------------------------

interface PendingAdvance {
  fromVideoId: string;
  intoVideoId: string;
}

interface ListenerTrackInput {
  playerVideoId: string | null;
  advance: PendingAdvance | null;
}

function listenerTrackId(input: ListenerTrackInput): string | null {
  const { playerVideoId, advance } = input;
  if (advance === null) return playerVideoId;
  if (playerVideoId === null || playerVideoId === advance.fromVideoId) return advance.intoVideoId;
  return playerVideoId;
}

export { listenerTrackId };
export type { ListenerTrackInput, PendingAdvance };
