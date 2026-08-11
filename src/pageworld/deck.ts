// -- Deck --------------------------------------------------------------------

import { gainsForMixLevel } from "@/pageworld/gain-law";

interface DeckDeps {
  context: AudioContext;
  output: AudioNode;
}

type DeckKind = "stems" | "mix";

type DeckLoad =
  | {
      kind: "stems";
      vocals: Float32Array<ArrayBuffer>[];
      instrumental: Float32Array<ArrayBuffer>[];
      sampleRate: number;
      trackId: string | null;
    }
  | { kind: "mix"; mix: AudioBuffer; trackId: string | null };

interface DeckState {
  kind: DeckKind;
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
  load(request: DeckLoad): boolean;
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

interface LoadedAudio {
  kind: DeckKind;
  trackId: string | null;
  vocals: AudioBuffer | null;
  instrumental: AudioBuffer;
  durationSeconds: number;
  vocalsRms: number;
  instrumentalRms: number;
  combinedPeak: number;
}

interface Loudness {
  vocalsRms: number;
  instrumentalRms: number;
  combinedPeak: number;
}

function measureMixLoudness(mix: AudioBuffer): Loudness {
  let sum = 0;
  let peak = 0;
  let counted = 0;

  for (let channel = 0; channel < mix.numberOfChannels; channel++) {
    const samples = mix.getChannelData(channel);
    for (let n = 0; n < samples.length; n++) {
      sum += samples[n] * samples[n];
      const level = Math.abs(samples[n]);
      if (level > peak) peak = level;
    }
    counted += samples.length;
  }

  return {
    vocalsRms: 0,
    instrumentalRms: Math.sqrt(sum / Math.max(1, counted)),
    combinedPeak: peak,
  };
}

function measureLoudness(instrumental: AudioBuffer, vocals: AudioBuffer | null): Loudness {
  if (vocals === null) return measureMixLoudness(instrumental);

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

interface DeckBuffers {
  vocals: AudioBuffer | null;
  instrumental: AudioBuffer;
}

function buffersForLoad(context: AudioContext, request: DeckLoad): DeckBuffers | null {
  if (request.kind === "mix") return { vocals: null, instrumental: request.mix };
  if (request.vocals.length === 0 || request.instrumental.length === 0) return null;
  return {
    vocals: createStemBuffer(context, request.vocals, request.sampleRate),
    instrumental: createStemBuffer(context, request.instrumental, request.sampleRate),
  };
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
  let loaded: LoadedAudio | null = null;
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

  function load(request: DeckLoad): boolean {
    stop();
    const buffers = buffersForLoad(context, request);
    if (buffers === null) return false;

    finished = false;
    loaded = {
      kind: request.kind,
      trackId: request.trackId,
      vocals: buffers.vocals,
      instrumental: buffers.instrumental,
      durationSeconds: buffers.instrumental.duration,
      ...measureLoudness(buffers.instrumental, buffers.vocals),
    };
    return true;
  }

  function startAt(offsetSeconds: number, when = 0): void {
    if (!loaded) return;
    stop();
    finished = false;

    if (loaded.vocals !== null) {
      vocalsSource = context.createBufferSource();
      vocalsSource.buffer = loaded.vocals;
      vocalsSource.connect(vocalsGainNode);
    }
    instrumentalSource = context.createBufferSource();
    instrumentalSource.buffer = loaded.instrumental;
    instrumentalSource.connect(instrumentalGainNode);
    releaseWhenEnded(vocalsSource, instrumentalSource);
    vocalsSource?.start(when, offsetSeconds);
    instrumentalSource.start(when, offsetSeconds);

    startedAtOffsetSeconds = offsetSeconds;
    startedAtContextTime = when === 0 ? context.currentTime : when;
    applyMixLevel(currentMixLevel);
  }

  function positionNow(): number {
    if (instrumentalSource === null || loaded === null) return Number.NaN;
    const elapsed = startedAtOffsetSeconds + (context.currentTime - startedAtContextTime);
    return Math.min(elapsed, loaded.durationSeconds);
  }

  function describe(): DeckState {
    return {
      kind: loaded?.kind ?? "stems",
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
export type { Deck, DeckDeps, DeckKind, DeckLoad, DeckState };
