// -- Deck --------------------------------------------------------------------

import { gainsForMixLevel } from "@/pageworld/gain-law";

interface DeckDeps {
  context: AudioContext;
  output: AudioNode;
}

interface DeckState {
  stemsLoaded: boolean;
  stemFrames: number;
  stemSampleRate: number;
  instrumentalRms: number;
  playing: boolean;
  vocalsGain: number;
  instrumentalGain: number;
  deckGain: number;
  positionSeconds: number;
  durationSeconds: number;
}

interface Deck {
  load(vocals: Float32Array<ArrayBuffer>[], instrumental: Float32Array<ArrayBuffer>[], sampleRate: number): boolean;
  startAt(offsetSeconds: number, when?: number): void;
  stop(): void;
  stopAt(when: number): void;
  setMixLevel(mixLevel: number): void;
  hasStems(): boolean;
  isPlaying(): boolean;
  durationSeconds(): number;
  positionNow(): number;
  gainParam(): AudioParam;
  setGain(value: number): void;
  describe(): DeckState;
  dispose(): void;
}

interface LoadedStems {
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
  durationSeconds: number;
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

  function stopAt(when: number): void {
    const vocals = vocalsSource;
    const instrumental = instrumentalSource;
    if (instrumental === null) return;

    instrumental.onended = () => {
      if (instrumentalSource !== instrumental) return;
      vocals?.disconnect();
      instrumental.disconnect();
      vocalsSource = null;
      instrumentalSource = null;
    };
    vocals?.stop(when);
    instrumental.stop(when);
  }

  function load(
    vocals: Float32Array<ArrayBuffer>[],
    instrumental: Float32Array<ArrayBuffer>[],
    sampleRate: number
  ): boolean {
    stop();
    if (vocals.length === 0 || instrumental.length === 0) return false;

    const vocalsBuffer = createStemBuffer(context, vocals, sampleRate);
    const instrumentalBuffer = createStemBuffer(context, instrumental, sampleRate);
    loaded = {
      vocals: vocalsBuffer,
      instrumental: instrumentalBuffer,
      durationSeconds: vocalsBuffer.duration,
    };
    return true;
  }

  function startAt(offsetSeconds: number, when = 0): void {
    if (!loaded) return;
    stop();

    vocalsSource = context.createBufferSource();
    vocalsSource.buffer = loaded.vocals;
    instrumentalSource = context.createBufferSource();
    instrumentalSource.buffer = loaded.instrumental;
    vocalsSource.connect(vocalsGainNode);
    instrumentalSource.connect(instrumentalGainNode);
    vocalsSource.start(when, offsetSeconds);
    instrumentalSource.start(when, offsetSeconds);

    startedAtOffsetSeconds = offsetSeconds;
    startedAtContextTime = when === 0 ? context.currentTime : when;
    applyMixLevel(currentMixLevel);
  }

  function positionNow(): number {
    if (instrumentalSource === null) return Number.NaN;
    return startedAtOffsetSeconds + (context.currentTime - startedAtContextTime);
  }

  function describe(): DeckState {
    const samples = loaded?.instrumental.getChannelData(0) ?? null;
    let instrumentalRms = 0;
    if (samples) {
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      instrumentalRms = Math.sqrt(sum / samples.length);
    }
    return {
      stemsLoaded: loaded !== null,
      stemFrames: samples?.length ?? 0,
      stemSampleRate: loaded?.instrumental.sampleRate ?? 0,
      instrumentalRms,
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
