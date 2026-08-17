// -- Stems, as the deck wants them --------------------------------------------

const FACTORY_SAMPLE_RATE = 48000;

let factory: OfflineAudioContext | null = null;

function bufferFactory(): OfflineAudioContext {
  factory ??= new OfflineAudioContext(1, 1, FACTORY_SAMPLE_RATE);
  return factory;
}

function toAudioBuffer(channels: Float32Array<ArrayBuffer>[], sampleRate: number): AudioBuffer {
  if (channels.length === 0) throw new Error("stem-buffers: a stem needs at least one channel");
  const buffer = bufferFactory().createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  return buffer;
}

interface StemBuffers {
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
}

function toStemBuffers(
  vocals: Float32Array<ArrayBuffer>[],
  instrumental: Float32Array<ArrayBuffer>[],
  sampleRate: number
): StemBuffers {
  return { vocals: toAudioBuffer(vocals, sampleRate), instrumental: toAudioBuffer(instrumental, sampleRate) };
}

export { toStemBuffers };
export type { StemBuffers };
