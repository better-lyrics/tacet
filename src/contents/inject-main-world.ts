import type { PlasmoCSConfig } from "plasmo";
import { isAdPlaying } from "@/capture/ad-state";
import { acquireAudioBus } from "@/pageworld/audio-bus";
import { decideEngagement, reconfirmAfterEmptied } from "@/pageworld/engagement";
import type { EngagementAction, TargetPosition } from "@/pageworld/engagement";
import { startPlayerBridge } from "@/pageworld/player-bridge";
import { createPlaybackGraph } from "@/pageworld/playback-graph";
import type { PlaybackGraph } from "@/pageworld/playback-graph";
import { currentPlayerSnapshot, playerVideoElement } from "@/pageworld/player-state";
import { isLoadStemsMessage, isSetMixLevelMessage, isStopStemsMessage } from "@/pageworld/protocol";
import { createLogger } from "@/shared/logger";

const logger = createLogger("page");

// -- Page-world audio graph --------------------------------------------------

export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN",
};

const RECONCILE_INTERVAL_MS = 1000;

interface LoadedStems {
  videoId: string;
  vocals: Float32Array<ArrayBuffer>[];
  instrumental: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  durationSeconds: number;
}

let cachedGraph: PlaybackGraph | null = null;
let cachedElement: HTMLMediaElement | null = null;
let acquiring: Promise<PlaybackGraph | null> | null = null;
let pendingMixLevel = 1;
let pendingStems: LoadedStems | null = null;
let engagedStems: LoadedStems | null = null;
let lastAction: EngagementAction = "idle";

logger.log("karaoke page world ready");

function decodedBytes(element: HTMLMediaElement): number {
  return (element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
}

function elementForStems(stems: LoadedStems): HTMLMediaElement | null {
  const snapshot = currentPlayerSnapshot(document);
  if (!snapshot || snapshot.videoId !== stems.videoId) return null;
  const element = playerVideoElement(document);
  return element?.isConnected ? element : null;
}

function playerOnOtherTrack(stems: LoadedStems): boolean {
  const snapshot = currentPlayerSnapshot(document);
  return snapshot !== null && snapshot.videoId !== stems.videoId;
}

let awaitingReconfirmation = false;

function reconfirmIfPossible(stems: LoadedStems): void {
  if (!awaitingReconfirmation) return;
  const snapshot = currentPlayerSnapshot(document);
  const element = playerVideoElement(document);
  const decision = reconfirmAfterEmptied({
    playerVideoId: snapshot?.videoId ?? null,
    stemsVideoId: stems.videoId,
    elementDurationSeconds: element?.duration ?? Number.NaN,
    stemDurationSeconds: stems.durationSeconds,
  });
  if (decision === "confirmed") awaitingReconfirmation = false;
}

function stemsAreStale(stems: LoadedStems): boolean {
  return awaitingReconfirmation || playerOnOtherTrack(stems);
}

declare global {
  interface Window {
    blkKaraokeProbe: () => unknown;
    blkCrossfadeSelfTest: (fadeSeconds?: number) => Promise<unknown>;
  }
}

window.blkKaraokeProbe = () => {
  const snapshot = currentPlayerSnapshot(document);
  const element = playerVideoElement(document);
  return {
    hasGraph: cachedGraph !== null,
    lastAction,
    adPlaying: isAdPlaying(document),
    acquiring: acquiring !== null,
    targetPosition: pendingStems ? targetPosition(pendingStems) : null,
    stemsPending: pendingStems !== null,
    stemsVideoId: pendingStems?.videoId ?? null,
    stemDurationSeconds: pendingStems ? +pendingStems.durationSeconds.toFixed(2) : null,
    playerVideoId: snapshot?.videoId ?? null,
    playerDurationSeconds: snapshot ? +snapshot.durationSeconds.toFixed(2) : null,
    audibleElementDecodedBytes: cachedElement ? decodedBytes(cachedElement) : 0,
    boundToPlayerElement: cachedElement !== null && cachedElement === element,
    graph: cachedGraph?.describe() ?? null,
  };
};

// -- Crossfade self test -----------------------------------------------------

const SELF_TEST_SECONDS = 60;

function selfTestStems(sampleRate: number, hz: number): Float32Array<ArrayBuffer>[] {
  const frames = Math.floor(sampleRate * SELF_TEST_SECONDS);
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) data[i] = Math.sin(2 * Math.PI * hz * (i / sampleRate)) * 0.25;
    channels.push(data);
  }
  return channels;
}

window.blkCrossfadeSelfTest = async (fadeSeconds = 4) => {
  const element = playerVideoElement(document);
  if (!element) return { error: "no player element" };

  const graph = cachedGraph ?? (await buildGraph(element));
  if (!graph) return { error: "could not acquire the audio bus" };

  const sampleRate = 44100;
  // Crossfade out of whatever is genuinely playing when there is something,
  // so the outgoing deck carries real separated stems rather than a tone.
  const outgoingIsReal = graph.describe().stemsPlaying;
  if (!outgoingIsReal) {
    graph.loadStems(selfTestStems(sampleRate, 220), selfTestStems(sampleRate, 220), sampleRate);
    graph.setMixLevel(1);
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  const before = graph.describe();
  if (!before.stemsPlaying) return { error: "no deck is playing, nothing to fade out of", state: before };
  const result = graph.crossfadeTo({
    vocals: selfTestStems(sampleRate, 330),
    instrumental: selfTestStems(sampleRate, 330),
    sampleRate,
    durationSeconds: fadeSeconds,
    incomingOffsetSeconds: 0,
  });

  const samples: { t: number; gain0: number; gain1: number }[] = [];
  const startedAt = performance.now();
  await new Promise<void>(resolve => {
    const timer = setInterval(() => {
      const state = graph.describe();
      samples.push({
        t: +((performance.now() - startedAt) / 1000).toFixed(3),
        gain0: state.decks[0].deckGain,
        gain1: state.decks[1].deckGain,
      });
      if (performance.now() - startedAt > (fadeSeconds + 1) * 1000) {
        clearInterval(timer);
        resolve();
      }
    }, 40);
  });

  const after = graph.describe();
  const inFade = samples.filter(s => s.t > 0.15 && s.t < fadeSeconds - 0.15);
  const powerError = inFade.map(s => Math.abs(s.gain0 ** 2 + s.gain1 ** 2 - 1));
  return {
    crossfade: result,
    outgoingWasRealSeparatedAudio: outgoingIsReal,
    outgoingInstrumentalRms: before.decks[before.activeDeck].instrumentalRms,
    beforeEngaged: before.engaged,
    beforeStemsPlaying: before.stemsPlaying,
    deckSwapped: before.activeDeck !== after.activeDeck,
    gain0: { first: samples[0]?.gain0 ?? null, last: samples.at(-1)?.gain0 ?? null },
    gain1: { first: samples[0]?.gain1 ?? null, last: samples.at(-1)?.gain1 ?? null },
    worstPowerErrorPct: +((Math.max(...powerError) || 0) * 100).toFixed(2),
    outgoingStillPlaying: after.decks[before.activeDeck].playing,
    incomingPlaying: after.decks[after.activeDeck].playing,
    originalGain: after.originalGain,
    sampleCount: samples.length,
  };
};

function discardGraph(): void {
  if (!cachedGraph) return;
  cachedGraph.stopStems();
  // dispose, not just stop: the listeners would keep restarting the sources.
  cachedGraph.dispose();
  cachedGraph = null;
  cachedElement = null;
  engagedStems = null;
}

function applyStems(graph: PlaybackGraph, stems: LoadedStems): void {
  graph.loadStems(stems.vocals, stems.instrumental, stems.sampleRate);
  graph.setMixLevel(pendingMixLevel);
  engagedStems = stems;
  awaitingReconfirmation = false;
  logger.log(`stems playing for videoId=${stems.videoId}, mix level ${pendingMixLevel}`);
}

function buildGraph(element: HTMLMediaElement): Promise<PlaybackGraph | null> {
  return acquireAudioBus(element).then(bus => {
    if (!bus) {
      logger.warn("could not acquire the audio bus, playback is unchanged");
      return null;
    }
    logger.log(`audio bus acquired, context=${bus.context.state}, element decoded bytes=${decodedBytes(bus.element)}`);

    const graph = createPlaybackGraph({ context: bus.context, source: bus.source });
    cachedElement = bus.element;

    bus.context.addEventListener("statechange", () => {
      if (bus.context.state === "running") return;
      bus.context
        .resume()
        .catch(error => logger.warn("context resume failed", error))
        .finally(() => {
          if (bus.context.state === "running") {
            logger.log("context recovered, stems still engaged");
            return;
          }
          logger.warn(`context stuck in "${bus.context.state}", bypassing to the original`);
          graph.stopStems();
        });
    });

    cachedGraph = graph;
    return graph;
  });
}

function targetPosition(stems: LoadedStems): TargetPosition {
  const target = elementForStems(stems);
  if (!target) return "none";
  return target === cachedElement ? "same" : "other";
}

function reconcile(): void {
  const stems = pendingStems;
  if (!stems) return;

  reconfirmIfPossible(stems);

  const action = decideEngagement({
    hasStems: true,
    graph: cachedGraph ? "bound" : "none",
    boundElementConnected: cachedElement?.isConnected ?? false,
    target: targetPosition(stems),
    acquiring: acquiring !== null,
    stemsEngaged: engagedStems === stems,
    stemsAudible: cachedGraph?.isEngaged() ?? false,
    adPlaying: isAdPlaying(document),
    stemsAreStale: stemsAreStale(stems),
  });
  lastAction = action;

  if (action === "idle" || action === "hold") return;

  if (action === "release" || action === "suspend") {
    cachedGraph?.stopStems();
    if (action === "release") engagedStems = null;
    return;
  }

  if (action === "resume") {
    cachedGraph?.resumeStems();
    return;
  }

  if (action === "load" && cachedGraph) {
    applyStems(cachedGraph, stems);
    return;
  }

  if (action === "rebind") {
    logger.warn("the element these stems belong to changed, tearing the graph down");
    discardGraph();
    return;
  }

  const target = elementForStems(stems);
  if (!target) return;

  acquiring = buildGraph(target).finally(() => {
    acquiring = null;
  });

  void acquiring.then(graph => {
    if (!graph || pendingStems !== stems) return;
    if (targetPosition(stems) === "other") {
      logger.warn("the audio bus bound a different element than the stems match, leaving it disengaged");
      discardGraph();
      return;
    }
    applyStems(graph, stems);
  });
}

setInterval(reconcile, RECONCILE_INTERVAL_MS);
startPlayerBridge();

document.addEventListener(
  "emptied",
  () => {
    awaitingReconfirmation = true;
    reconcile();
  },
  true
);
for (const event of ["loadstart", "play", "playing"]) {
  document.addEventListener(event, reconcile, true);
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;

  if (isSetMixLevelMessage(data)) {
    pendingMixLevel = data.mixLevel;
    cachedGraph?.setMixLevel(data.mixLevel);
    return;
  }

  if (isLoadStemsMessage(data)) {
    const durationSeconds = (data.vocals[0]?.length ?? 0) / data.sampleRate;
    logger.log(
      `load-stems received for videoId=${data.videoId}, sampleRate=${data.sampleRate}, channels=${data.vocals.length}, duration=${durationSeconds.toFixed(1)}s`
    );
    pendingStems = {
      videoId: data.videoId,
      vocals: data.vocals,
      instrumental: data.instrumental,
      sampleRate: data.sampleRate,
      durationSeconds,
    };
    reconcile();
    return;
  }

  if (isStopStemsMessage(data)) {
    pendingStems = null;
    engagedStems = null;
    cachedGraph?.stopStems();
  }
});
