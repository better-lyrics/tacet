// -- Where the crossfade wipe should be ----------------------------------------

function wipeElapsedMs(startedAtMs: number, nowMs: number, durationMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(Math.max(0, nowMs - startedAtMs), durationMs);
}

export { wipeElapsedMs };
