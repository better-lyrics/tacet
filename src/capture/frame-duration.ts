// -- Track duration inside a worker frame -------------------------------------

function frameTrackDuration(playerSeconds: number, elementSeconds: number): number {
  if (Number.isFinite(playerSeconds) && playerSeconds > 0) return playerSeconds;
  return Number.isFinite(elementSeconds) && elementSeconds > 0 ? elementSeconds : 0;
}

function settledFrameDuration(adPlaying: boolean, playerSeconds: number, elementSeconds: number): number {
  return adPlaying ? 0 : frameTrackDuration(playerSeconds, elementSeconds);
}

export { frameTrackDuration, settledFrameDuration };
