import { chooseShadowUrl } from "@/acquisition/shadow-url";
import type { MintedStream } from "@/acquisition/minted-url";
import { log } from "@/capture/log";

// -- Minting a url with a second player in this very document --------------------

// The page will build a second player beside the listener's own and point it at
// any track. It deciphers and attests the media url itself, which is the whole
// reason this exists: no frame, no BotGuard, no signature transform. The player
// is a url minter and nothing more, so it is disposed the moment a usable url
// appears and the bytes are pulled long afterwards.

const SHADOW_HOST_ID = "blk-shadow-player";

const SHADOW_HOST_STYLE =
  "position:fixed;left:-9999px;top:-9999px;width:320px;height:180px;opacity:0;pointer-events:none";

const MUSIC_PLAYER_CONFIG_KEY = "WEB_PLAYER_CONTEXT_CONFIG_ID_MUSIC_WATCH";

const DEFAULT_TIMEOUT_MS = 20_000;

const POLL_INTERVAL_MS = 100;

interface ShadowApplication {
  dispose?: () => void;
}

interface ShadowPlayerElement extends HTMLElement {
  loadVideoById?: (videoId: string) => void;
  mute?: () => void;
  setVolume?: (volume: number) => void;
}

interface PageWithPlayer {
  yt?: {
    player?: {
      Application?: {
        create?: (element: HTMLElement, options: unknown, config: unknown) => ShadowApplication;
      };
    };
  };
  ytcfg?: { get?: (key: string) => unknown };
}

function page(): PageWithPlayer {
  return window as unknown as PageWithPlayer;
}

// -- Taking the format choice away from the player's own chooser -----------------

// The shadow's /player response already carries every format the account is
// entitled to, itag 141 included. What differs from the listener's own player is
// only the client-side chooser, which starts conservative on a fresh player and
// lands on 251. Filtering the response down to one audio format leaves it nothing
// to choose. Setting the account's audio quality does not work: the shadow
// already reads back the same value the listener's player does.

interface ForcedFormat {
  videoId: string;
  itag: number;
}

let forced: ForcedFormat | null = null;

const expectedLengths = new Map<string, number>();

function isPlayerRequest(url: unknown): boolean {
  return /\/youtubei\/v1\/player(\?|$)/.test(String(url).split("#")[0]);
}

function rewritePlayerResponse(raw: string, videoId: string, itag: number | null): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
  const streaming = (parsed as { streamingData?: { adaptiveFormats?: unknown } }).streamingData;
  if (streaming === undefined) return raw;
  const formats = streaming.adaptiveFormats;
  if (!Array.isArray(formats)) return raw;

  const isAudio = (format: unknown): boolean =>
    String((format as { mimeType?: unknown }).mimeType ?? "").startsWith("audio");
  const itagOf = (format: unknown): string => String((format as { itag?: unknown }).itag);

  const wanted = formats.find(format => isAudio(format) && itagOf(format) === String(itag));
  const length = Number((wanted as { contentLength?: unknown } | undefined)?.contentLength);
  if (Number.isFinite(length) && length > 0) expectedLengths.set(videoId, length);

  if (itag === null || wanted === undefined) return raw;
  // Only the one audio format survives. Leaving the video formats in makes the
  // shadow stream video as well, measured as itag 243 alongside the audio, which
  // is bandwidth spent competing with the listener's own stream for bytes we
  // throw away.
  streaming.adaptiveFormats = [wanted];
  return JSON.stringify(parsed);
}

let filterInstalled = false;

function installPlayerResponseFilter(): void {
  if (filterInstalled) return;
  filterInstalled = true;

  const proto = XMLHttpRequest.prototype;
  const textDescriptor = Object.getOwnPropertyDescriptor(proto, "responseText");
  const responseDescriptor = Object.getOwnPropertyDescriptor(proto, "response");
  if (!textDescriptor?.get || !responseDescriptor?.get) return;
  const readText = textDescriptor.get;
  const readResponse = responseDescriptor.get;

  const openOriginal: (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    isAsync?: boolean,
    username?: string | null,
    password?: string | null
  ) => void = proto.open;
  const sendOriginal = proto.send;
  const urls = new WeakMap<XMLHttpRequest, unknown>();

  proto.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    isAsync: boolean = true,
    username?: string | null,
    password?: string | null
  ): void {
    urls.set(this, url);
    openOriginal.call(this, method, url, isAsync, username, password);
  };

  // The player registers its own load handler before calling send, so a listener
  // added here would run second and be too late. A getter runs when the value is
  // read, which makes the rewrite independent of handler order.
  proto.send = function patchedSend(this: XMLHttpRequest, ...args: Parameters<typeof sendOriginal>) {
    if (isPlayerRequest(urls.get(this))) {
      let videoId: string | null = null;
      try {
        videoId = (JSON.parse(String(args[0])) as { videoId?: string }).videoId ?? null;
      } catch {
        videoId = null;
      }
      if (videoId !== null) {
        const target = videoId;
        const itag = forced !== null && forced.videoId === target ? forced.itag : null;
        const transform = (raw: unknown): unknown =>
          typeof raw === "string" ? rewritePlayerResponse(raw, target, itag) : raw;
        Object.defineProperty(this, "responseText", {
          configurable: true,
          get(this: XMLHttpRequest) {
            return transform(readText.call(this));
          },
        });
        Object.defineProperty(this, "response", {
          configurable: true,
          get(this: XMLHttpRequest) {
            return transform(readResponse.call(this));
          },
        });
      }
    }
    return sendOriginal.apply(this, args);
  };
}

// -- Watching what the shadow fetches -------------------------------------------

function observeMediaUrls(): { urls: string[]; stop: () => void } {
  const urls: string[] = [];
  const observer = new PerformanceObserver(entries => {
    for (const entry of entries.getEntries()) {
      if (entry.name.includes("googlevideo.com")) urls.push(entry.name);
    }
  });
  observer.observe({ type: "resource", buffered: false });
  return { urls, stop: () => observer.disconnect() };
}

// -- The mint -------------------------------------------------------------------

interface ShadowMintInput {
  videoId: string;
  itag: number;
  timeoutMs?: number;
}

interface ShadowMintResult {
  minted: MintedStream | null;
  reason: string;
  elapsedMs: number;
}

function removeShadowHost(): void {
  document.getElementById(SHADOW_HOST_ID)?.remove();
}

// -- Keeping the shadow silent ---------------------------------------------------

// `mute: "1"` in the construction args is not enough, and `loadVideoById` starts
// playback rather than merely loading, so an unsilenced shadow is audible over the
// listener's own track. Measured with a 20ms sampler: the element appears at
// volume 1 unmuted and was audible for two samples before a 100ms poll caught it.
// Polling cannot win that race, so this is event driven: mute on the mutation that
// adds the element, and mute again on any `volumechange` the player issues when it
// restores the listener's own volume. Scoped to the host, so the listener's own
// player is never touched.
// Re-muting after the fact always loses some window, however tight the loop: the
// element is born at volume 1 and the player restores the listener's own volume
// once the media loads. Locking the two properties on the instance, which shadows
// the prototype accessors, means the player cannot unmute it at all. Measured
// before this: two samples at volume 1, and one of them after the element had
// metadata. Nothing was ever audible, because decoded bytes were zero throughout,
// but a window that only closes in time is not the same as one that cannot open.
function silenceMedia(media: HTMLMediaElement): void {
  const locked = media as HTMLMediaElement & { __blkSilenced?: boolean };
  if (locked.__blkSilenced === true) return;
  locked.__blkSilenced = true;
  try {
    media.muted = true;
    media.volume = 0;
    Object.defineProperty(media, "muted", { configurable: true, get: () => true, set: () => undefined });
    Object.defineProperty(media, "volume", { configurable: true, get: () => 0, set: () => undefined });
  } catch {
    media.muted = true;
    media.volume = 0;
  }
}

function silenceShadow(host: HTMLElement): void {
  const element = host.querySelector<ShadowPlayerElement>("#movie_player");
  try {
    element?.mute?.();
    element?.setVolume?.(0);
  } catch {
    // the player api is not ready yet, the element level mute below still holds
  }
  for (const media of host.querySelectorAll("video, audio")) silenceMedia(media as HTMLMediaElement);
}

function keepShadowSilent(host: HTMLElement): () => void {
  const watched = new WeakSet<HTMLMediaElement>();
  const onVolumeChange = (event: Event): void => silenceMedia(event.target as HTMLMediaElement);

  const silenceAll = (): void => {
    for (const media of host.querySelectorAll("video, audio")) {
      const playable = media as HTMLMediaElement;
      silenceMedia(playable);
      if (watched.has(playable)) continue;
      watched.add(playable);
      for (const name of ["volumechange", "loadedmetadata", "play", "playing"]) {
        playable.addEventListener(name, onVolumeChange);
      }
    }
  };

  silenceAll();
  const observer = new MutationObserver(silenceAll);
  observer.observe(host, { childList: true, subtree: true });
  return () => observer.disconnect();
}

async function mintShadowUrl(input: ShadowMintInput): Promise<ShadowMintResult> {
  const started = performance.now();
  const finish = (minted: MintedStream | null, reason: string): ShadowMintResult => ({
    minted,
    reason,
    elapsedMs: Math.round(performance.now() - started),
  });

  const create = page().yt?.player?.Application?.create;
  const config = page().ytcfg?.get?.("WEB_PLAYER_CONTEXT_CONFIGS");
  const playerConfig = (config as Record<string, unknown> | undefined)?.[MUSIC_PLAYER_CONFIG_KEY];
  if (typeof create !== "function" || playerConfig === undefined) {
    return finish(null, "this page has no player to build a shadow from");
  }

  installPlayerResponseFilter();
  removeShadowHost();
  expectedLengths.delete(input.videoId);
  forced = { videoId: input.videoId, itag: input.itag };

  const watch = observeMediaUrls();
  const host = document.createElement("div");
  host.id = SHADOW_HOST_ID;
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = SHADOW_HOST_STYLE;
  document.body.append(host);

  const stopSilencing = keepShadowSilent(host);
  let application: ShadowApplication | null = null;
  try {
    application = create(host, { args: { autoplay: "0", mute: "1", controls: "0" } }, playerConfig);
    silenceShadow(host);
    const element: ShadowPlayerElement | null = host.querySelector("#movie_player");
    element?.loadVideoById?.(input.videoId);
    silenceShadow(host);
  } catch (error) {
    stopSilencing();
    watch.stop();
    forced = null;
    removeShadowHost();
    return finish(null, `the shadow player would not start: ${String(error)}`);
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let minted: MintedStream | null = null;
  while (performance.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    silenceShadow(host);
    minted = chooseShadowUrl(watch.urls, {
      itag: input.itag,
      contentLengthBytes: expectedLengths.get(input.videoId) ?? null,
    });
    if (minted) break;
  }

  watch.stop();
  forced = null;
  stopSilencing();
  try {
    application?.dispose?.();
  } catch (error) {
    log(`the shadow player would not dispose cleanly: ${String(error)}`);
  }
  removeShadowHost();

  if (!minted) return finish(null, `no attested url appeared for ${input.videoId} within ${timeoutMs}ms`);
  return finish(minted, `minted itag ${minted.itag} for ${input.videoId}`);
}

export { DEFAULT_TIMEOUT_MS, SHADOW_HOST_ID, installPlayerResponseFilter, mintShadowUrl, rewritePlayerResponse };
export type { ShadowMintInput, ShadowMintResult };
