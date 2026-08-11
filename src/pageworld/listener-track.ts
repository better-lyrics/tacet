// -- Which track the listener is on ------------------------------------------

// A transition starts the incoming deck and then tells the player to advance,
// so for a few seconds the player still names the track we faded out of while
// its clock already counts the one we moved to. Reading the name there is how
// the previous track's stems end up playing against the current track's
// playhead: cleanly, at the right volume, and completely wrong.
//
// The clock lives in the caller. This only does the arithmetic, so it can be
// tested without a player.

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
  // Silence and the old name both mean the advance has not landed. Any other
  // name means the listener went somewhere of their own accord, and that
  // outranks anything we asked for.
  if (playerVideoId === null || playerVideoId === advance.fromVideoId) return advance.intoVideoId;
  return playerVideoId;
}

export { listenerTrackId };
export type { ListenerTrackInput, PendingAdvance };
