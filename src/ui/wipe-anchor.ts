// -- Where the crossfade wipe should be ----------------------------------------

// Re-inserting an element restarts its CSS animations from the beginning, and
// `mountTo` re-appends the button every time Better Lyrics rebuilds its dock. So
// a wipe part way through a fade jumped back to the left edge and was then
// deleted on its original deadline, which read as the animation stopping midway.
// The wipe's position is a function of wall clock time rather than of when the
// element last happened to be inserted, and this is that function.

function wipeElapsedMs(startedAtMs: number, nowMs: number, durationMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(Math.max(0, nowMs - startedAtMs), durationMs);
}

export { wipeElapsedMs };
