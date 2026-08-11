// -- Deck --------------------------------------------------------------------

import { gainsForMixLevel } from "@/pageworld/gain-law";

interface DeckDeps {
  context: AudioContext;
  output: AudioNode;
}

interface DeckState {
  stemsLoaded: boolean;
  trackId: string | null;
  finished: boolean;
  stemFrames: number;
  stemSampleRate: number;
  vocalsRms: number;
  instrumentalRms: number;
  combinedPeak: number;
  playing: boolean;
  vocalsGain: number;
  instrumentalGain: number;
  deckGain: number;
  positionSeconds: number;
  durationSeconds: number;
}

interface Deck {
  load(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number,
    trackId: string | null
  ): boolean;
  startAt(offsetSeconds: number, when?: number): void;
  stop(): void;
  stopAt(when: number): void;
  setMixLevel(mixLevel: number): void;
  hasStems(): boolean;
  isPlaying(): boolean;
  hasFinished(): boolean;
  trackId(): string | null;
  durationSeconds(): number;
  positionNow(): number;
  gainParam(): AudioParam;
  setGain(value: number): void;
  describe(): DeckState;
  dispose(): void;
}

interface LoadedStems {
  trackId: string | null;
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
  durationSeconds: number;
  // Measured once at load. Scanning the buffer per describe() call is millions
  // of operations, and describe() is on the probe path.
  vocalsRms: number;
  instrumentalRms: number;
  combinedPeak: number;
}

interface Loudness {
  vocalsRms: number;
  instrumentalRms: number;
  combinedPeak: number;
}

function measureLoudness(vocals: AudioBuffer, instrumental: AudioBuffer): Loudness {
  let vocalsSum = 0;
  let instrumentalSum = 0;
  let peak = 0;
  let counted = 0;

  const channels = Math.min(vocals.numberOfChannels, instrumental.numberOfChannels);
  for (let channel = 0; channel < channels; channel++) {
    const v = vocals.getChannelData(channel);
    const i = instrumental.getChannelData(channel);
    const frames = Math.min(v.length, i.length);
    for (let n = 0; n < frames; n++) {
      vocalsSum += v[n] * v[n];
      instrumentalSum += i[n] * i[n];
      const combined = Math.abs(v[n] + i[n]);
      if (combined > peak) peak = combined;
    }
    counted += frames;
  }

  const divisor = Math.max(1, counted);
  return {
    vocalsRms: Math.sqrt(vocalsSum / divisor),
    instrumentalRms: Math.sqrt(instrumentalSum / divisor),
    combinedPeak: peak,
  };
}

function createStemBuffer(
  context: AudioContext,
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number
): AudioBuffer {
  if (channels.length === 0) {
    throw new Error("deck: a stem needs at least one channel");
  }
  const buffer = context.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  return buffer;
}

function createDeck(deps: DeckDeps): Deck {
  const { context, output } = deps;

  const deckGainNode = context.createGain();
  deckGainNode.gain.value = 1;
  deckGainNode.connect(output);

  const vocalsGainNode = context.createGain();
  const instrumentalGainNode = context.createGain();
  vocalsGainNode.connect(deckGainNode);
  instrumentalGainNode.connect(deckGainNode);

  let vocalsSource: AudioBufferSourceNode | null = null;
  let instrumentalSource: AudioBufferSourceNode | null = null;
  let loaded: LoadedStems | null = null;
  let currentMixLevel = 1;
  let startedAtOffsetSeconds = 0;
  let startedAtContextTime = 0;
  let finished = false;

  function applyMixLevel(mixLevel: number): void {
    currentMixLevel = mixLevel;
    const gains = gainsForMixLevel(mixLevel);
    vocalsGainNode.gain.value = gains.vocalsGain;
    instrumentalGainNode.gain.value = gains.instrumentalGain;
  }

  function stop(): void {
    vocalsSource?.stop();
    vocalsSource?.disconnect();
    instrumentalSource?.stop();
    instrumentalSource?.disconnect();
    vocalsSource = null;
    instrumentalSource = null;
  }

  function releaseWhenEnded(vocals: AudioBufferSourceNode | null, instrumental: AudioBufferSourceNode): void {
    instrumental.onended = () => {
      if (instrumentalSource !== instrumental) return;
      vocals?.disconnect();
      instrumental.disconnect();
      vocalsSource = null;
      instrumentalSource = null;
      // Reaching the end of the buffer and being stopped early both leave the
      // deck silent, and only one of them is worth recovering from.
      finished = true;
    };
  }

  function stopAt(when: number): void {
    const vocals = vocalsSource;
    const instrumental = instrumentalSource;
    if (instrumental === null) return;

    releaseWhenEnded(vocals, instrumental);
    vocals?.stop(when);
    instrumental.stop(when);
  }

  function load(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number,
    trackId: string | null
  ): boolean {
    stop();
    if (vocals.length === 0 || instrumental.length === 0) return false;

    finished = false;
    const vocalsBuffer = createStemBuffer(context, vocals, sampleRate);
    const instrumentalBuffer = createStemBuffer(context, instrumental, sampleRate);
    loaded = {
      trackId,
      vocals: vocalsBuffer,
      instrumental: instrumentalBuffer,
      durationSeconds: vocalsBuffer.duration,
      ...measureLoudness(vocalsBuffer, instrumentalBuffer),
    };
    return true;
  }

  function startAt(offsetSeconds: number, when = 0): void {
    if (!loaded) return;
    stop();
    finished = false;

    vocalsSource = context.createBufferSource();
    vocalsSource.buffer = loaded.vocals;
    instrumentalSource = context.createBufferSource();
    instrumentalSource.buffer = loaded.instrumental;
    vocalsSource.connect(vocalsGainNode);
    instrumentalSource.connect(instrumentalGainNode);
    // Without this the deck reports itself as playing for ever once the buffer
    // runs out, and positionNow() counts past the end of the track, which reads
    // to anything downstream as a track with negative time remaining.
    releaseWhenEnded(vocalsSource, instrumentalSource);
    vocalsSource.start(when, offsetSeconds);
    instrumentalSource.start(when, offsetSeconds);

    startedAtOffsetSeconds = offsetSeconds;
    startedAtContextTime = when === 0 ? context.currentTime : when;
    applyMixLevel(currentMixLevel);
  }

  function positionNow(): number {
    if (instrumentalSource === null || loaded === null) return Number.NaN;
    const elapsed = startedAtOffsetSeconds + (context.currentTime - startedAtContextTime);
    // onended releases the sources, but it lands on a task queue, so the clamp
    // is what stops a late callback reading as negative time remaining.
    return Math.min(elapsed, loaded.durationSeconds);
  }

  function describe(): DeckState {
    return {
      stemsLoaded: loaded !== null,
      trackId: loaded?.trackId ?? null,
      finished,
      stemFrames: loaded?.instrumental.length ?? 0,
      stemSampleRate: loaded?.instrumental.sampleRate ?? 0,
      vocalsRms: loaded?.vocalsRms ?? 0,
      instrumentalRms: loaded?.instrumentalRms ?? 0,
      combinedPeak: loaded?.combinedPeak ?? 0,
      playing: instrumentalSource !== null,
      vocalsGain: vocalsGainNode.gain.value,
      instrumentalGain: instrumentalGainNode.gain.value,
      deckGain: deckGainNode.gain.value,
      positionSeconds: positionNow(),
      durationSeconds: loaded?.durationSeconds ?? 0,
    };
  }

  function dispose(): void {
    stop();
    loaded = null;
    vocalsGainNode.disconnect();
    instrumentalGainNode.disconnect();
    deckGainNode.disconnect();
  }

  return {
    load,
    startAt,
    stop,
    stopAt,
    setMixLevel: applyMixLevel,
    hasStems: () => loaded !== null,
    isPlaying: () => instrumentalSource !== null,
    hasFinished: () => finished,
    trackId: () => loaded?.trackId ?? null,
    durationSeconds: () => loaded?.durationSeconds ?? 0,
    positionNow,
    gainParam: () => deckGainNode.gain,
    setGain: value => {
      deckGainNode.gain.value = value;
    },
    describe,
    dispose,
  };
}

export { createDeck, createStemBuffer };
export type { Deck, DeckDeps, DeckState };
