import { chooseShadowUrl, judgeShadowUrl } from "@/acquisition/shadow-url";
import { readMintedUrl } from "@/acquisition/minted-url";
import { chooseBestAudioFormat, isAudioFormat } from "@/acquisition/audio-format";
import type { MintedStream } from "@/acquisition/minted-url";
import { log } from "@/capture/log";

// -- Minting a url with a second player in this very document --------------------

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

let forced: string | null = null;

const chosenFormats = new Map<string, { itag: number; contentLengthBytes: number | null }>();

function isPlayerRequest(url: unknown): boolean {
  return /\/youtubei\/v1\/player(\?|$)/.test(String(url).split("#")[0]);
}

function rewritePlayerResponse(raw: string, videoId: string, wanted: boolean): string {
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

  const best = chooseBestAudioFormat(formats);
  if (best === null) return raw;
  chosenFormats.set(videoId, { itag: best.itag, contentLengthBytes: best.contentLengthBytes });

  if (!wanted) return raw;
  const keep = formats.find(
    format => isAudioFormat(format) && Number((format as { itag?: unknown }).itag) === best.itag
  );
  if (keep === undefined) return raw;
  streaming.adaptiveFormats = formats.filter(format => !isAudioFormat(format)).concat([keep]);
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
        const ours = forced === target;
        const transform = (raw: unknown): unknown =>
          typeof raw === "string" ? rewritePlayerResponse(raw, target, ours) : raw;
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
  timeoutMs?: number;
}

interface ObservedUrl {
  itag: number | null;
  contentLengthBytes: number | null;
  tokenBytes: number;
  verdict: string;
}

interface ShadowMintResult {
  minted: MintedStream | null;
  reason: string;
  elapsedMs: number;
  observed: ObservedUrl[];
}

function removeShadowHost(): void {
  document.getElementById(SHADOW_HOST_ID)?.remove();
}

// -- Keeping the shadow silent ---------------------------------------------------

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
  } catch (error) {
    log(`the shadow player refused a mute, falling back to the element: ${String(error)}`);
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
  let observed: ObservedUrl[] = [];
  const finish = (minted: MintedStream | null, reason: string): ShadowMintResult => ({
    minted,
    reason,
    elapsedMs: Math.round(performance.now() - started),
    observed,
  });

  const create = page().yt?.player?.Application?.create;
  const config = page().ytcfg?.get?.("WEB_PLAYER_CONTEXT_CONFIGS");
  const playerConfig = (config as Record<string, unknown> | undefined)?.[MUSIC_PLAYER_CONFIG_KEY];
  if (typeof create !== "function" || playerConfig === undefined) {
    return finish(null, "this page has no player to build a shadow from");
  }

  installPlayerResponseFilter();
  removeShadowHost();
  chosenFormats.delete(input.videoId);
  forced = input.videoId;

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
    const chosen = chosenFormats.get(input.videoId);
    if (chosen === undefined) continue;
    minted = chooseShadowUrl(watch.urls, chosen);
    if (minted) break;
  }

  const target = chosenFormats.get(input.videoId) ?? { itag: -1, contentLengthBytes: null };
  observed = watch.urls.map(url => {
    const read = readMintedUrl(url);
    return {
      itag: read?.itag ?? null,
      contentLengthBytes: read?.contentLengthBytes ?? null,
      tokenBytes: read?.poToken?.byteLength ?? 0,
      verdict: judgeShadowUrl(read, target).reason,
    };
  });

  watch.stop();
  forced = null;
  stopSilencing();
  try {
    application?.dispose?.();
  } catch (error) {
    log(`the shadow player would not dispose cleanly: ${String(error)}`);
  }
  removeShadowHost();

  if (!minted) {
    const chosen = chosenFormats.get(input.videoId);
    const wanted = chosen ? `itag ${chosen.itag}` : "no format at all, the player response was never seen";
    return finish(null, `no attested url for ${wanted} appeared for ${input.videoId} within ${timeoutMs}ms`);
  }
  return finish(minted, `minted itag ${minted.itag} for ${input.videoId}`);
}

export { DEFAULT_TIMEOUT_MS, SHADOW_HOST_ID, installPlayerResponseFilter, mintShadowUrl, rewritePlayerResponse };
export type { ObservedUrl, ShadowMintInput, ShadowMintResult };
