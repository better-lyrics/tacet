// -- Shared audio bus --------------------------------------------------------

import { decideAudioBusClaim } from "@/pageworld/audio-bus-claim";
import { sourceBelongsToBus } from "@/pageworld/audio-bus-wiring";
import { createLogger } from "@/shared/logger";

const logger = createLogger("audio");

const AUDIO_BUS_VERSION = 1;
const AUDIO_BUS_KEY = "__blyricsAudio";

interface BlyricsAudioBus {
  version: number;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  element: HTMLMediaElement;
}

function isBlyricsAudioBus(value: unknown): value is BlyricsAudioBus {
  if (typeof value !== "object" || value === null) return false;
  const bus = value as Record<string, unknown>;
  if (
    typeof bus.version !== "number" ||
    !(bus.context instanceof AudioContext) ||
    !(bus.source instanceof MediaElementAudioSourceNode) ||
    !(bus.element instanceof HTMLMediaElement)
  ) {
    return false;
  }
  if (!sourceBelongsToBus(bus as unknown as BlyricsAudioBus)) {
    logger.error("a published bus has a source that does not belong to its context and element, ignoring it");
    return false;
  }
  return true;
}

function readWindowBus(): unknown {
  return (window as unknown as Record<string, unknown>)[AUDIO_BUS_KEY];
}

function writeWindowBus(bus: BlyricsAudioBus): void {
  (window as unknown as Record<string, unknown>)[AUDIO_BUS_KEY] = bus;
}

const RESUME_TIMEOUT_MS = 3000;

async function resumeOnGesture(context: AudioContext): Promise<boolean> {
  if (context.state !== "running") {
    try {
      await Promise.race([context.resume(), new Promise(resolve => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
    } catch (error) {
      logger.error("context.resume() failed", error);
    }
  }

  if (context.state === "running") return true;
  logger.warn(`context stuck in "${context.state}" after ${RESUME_TIMEOUT_MS}ms, not engaging yet`);
  return false;
}

const claimedElements = new WeakSet<HTMLMediaElement>();
const sourceByElement = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

async function acquireAudioBus(element: HTMLMediaElement): Promise<BlyricsAudioBus | null> {
  const existing = readWindowBus();
  const claim = decideAudioBusClaim(existing, AUDIO_BUS_VERSION, isBlyricsAudioBus);

  if (claim === "incompatible") return null;

  if (claim === "reuse") {
    const bus = existing as BlyricsAudioBus;
    if (bus.element === element && bus.element.isConnected) {
      return (await resumeOnGesture(bus.context)) ? bus : null;
    }
    logger.warn("the bus holds a different element, building one for this one");
  }

  const claimedSource = sourceByElement.get(element);
  if (claimedSource) {
    const context = claimedSource.context as AudioContext;
    if (!(await resumeOnGesture(context))) return null;
    const bus: BlyricsAudioBus = { version: AUDIO_BUS_VERSION, context, source: claimedSource, element };
    writeWindowBus(bus);
    return bus;
  }

  if (claimedElements.has(element)) {
    logger.error("this element was claimed by something else and can never be routed. Reload the page.");
    return null;
  }

  const context = new AudioContext();
  if (!(await resumeOnGesture(context))) {
    await context.close();
    return null;
  }

  let source: MediaElementAudioSourceNode;
  try {
    source = context.createMediaElementSource(element);
  } catch (error) {
    claimedElements.add(element);
    logger.error("cannot capture the audible element, its audio will keep playing untouched. Reload the page.", error);
    await context.close();
    return null;
  }
  claimedElements.add(element);
  sourceByElement.set(element, source);
  source.connect(context.destination);

  const bus: BlyricsAudioBus = { version: AUDIO_BUS_VERSION, context, source, element };
  writeWindowBus(bus);
  return bus;
}

export { AUDIO_BUS_VERSION, AUDIO_BUS_KEY, acquireAudioBus, isBlyricsAudioBus };
export type { BlyricsAudioBus };
