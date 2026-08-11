interface MediaElementLike {
  muted: boolean;
  volume: number;
}

type Setter = (this: unknown, value: never) => void;

function silenceElement(element: MediaElementLike): void {
  element.muted = true;
  element.volume = 0;
}

function silenceMediaIn(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll("video, audio"))) {
    silenceElement(element as unknown as MediaElementLike);
  }
}

function installForcedSilence(prototype: object): boolean {
  const mutedDescriptor = Object.getOwnPropertyDescriptor(prototype, "muted");
  const volumeDescriptor = Object.getOwnPropertyDescriptor(prototype, "volume");
  const setMuted = mutedDescriptor?.set as Setter | undefined;
  const setVolume = volumeDescriptor?.set as Setter | undefined;

  if (!setMuted || !setVolume) return false;

  Object.defineProperty(prototype, "muted", {
    configurable: true,
    enumerable: mutedDescriptor?.enumerable ?? false,
    get(): boolean {
      return true;
    },
    set(this: unknown): void {
      setMuted.call(this, true as never);
    },
  });

  Object.defineProperty(prototype, "volume", {
    configurable: true,
    enumerable: volumeDescriptor?.enumerable ?? false,
    get(): number {
      return 0;
    },
    set(this: unknown): void {
      setVolume.call(this, 0 as never);
    },
  });

  const originalPlay = (prototype as { play?: () => Promise<void> }).play;
  if (typeof originalPlay === "function") {
    (prototype as { play?: () => Promise<void> }).play = function (this: unknown): Promise<void> {
      setMuted.call(this, true as never);
      setVolume.call(this, 0 as never);
      return originalPlay.call(this);
    };
  }

  return true;
}

export { installForcedSilence, silenceMediaIn, silenceElement };
export type { MediaElementLike };
