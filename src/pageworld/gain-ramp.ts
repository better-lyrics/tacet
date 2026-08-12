// -- Changing a gain without a step -------------------------------------------

const GAIN_RAMP_SECONDS = 0.02;

function rampGainTo(param: AudioParam, context: BaseAudioContext, value: number, seconds = GAIN_RAMP_SECONDS): void {
  const now = context.currentTime;
  param.cancelAndHoldAtTime(now);
  if (Number.isFinite(seconds) && seconds > 0) {
    param.linearRampToValueAtTime(value, now + seconds);
    return;
  }
  param.setValueAtTime(value, now);
}

function rampGainFromZero(param: AudioParam, context: BaseAudioContext, seconds = GAIN_RAMP_SECONDS): void {
  const now = context.currentTime;
  const over = Number.isFinite(seconds) && seconds > 0 ? seconds : GAIN_RAMP_SECONDS;
  param.cancelAndHoldAtTime(now);
  param.setValueAtTime(0, now);
  param.linearRampToValueAtTime(1, now + over);
}

function scheduleGainCurve(
  param: AudioParam,
  context: BaseAudioContext,
  curve: Float32Array,
  startsAt: number,
  durationSeconds: number
): void {
  param.cancelAndHoldAtTime(context.currentTime);
  param.setValueCurveAtTime(curve, startsAt, durationSeconds);
}

export { GAIN_RAMP_SECONDS, rampGainFromZero, rampGainTo, scheduleGainCurve };
