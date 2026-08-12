<p align="center">
  <img src="assets/brand/logo.png" alt="Tacet" height="96" />
</p>

<h1 align="center">Tacet</h1>

<p align="center">
  A playback layer for YouTube Music, running entirely in your browser.
</p>

<p align="center">
  <a href="https://github.com/better-lyrics/tacet/releases/latest"><img src="https://img.shields.io/github/v/release/better-lyrics/tacet?include_prereleases&label=release&color=black" alt="Latest release" /></a>
  <a href="https://github.com/better-lyrics/tacet/releases"><img src="https://img.shields.io/github/downloads/better-lyrics/tacet/total?label=downloads&color=black" alt="Downloads" /></a>
  <a href="https://github.com/better-lyrics/tacet/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/better-lyrics/tacet/release.yml?label=build&color=black" alt="Build" /></a>
</p>

Tacet runs inside the YouTube Music page and adds playback controls the player
does not have. Today that means pulling the vocal out of a track so you can fade
it down to nothing for karaoke, and blending one song into the next instead of
letting it stop dead. More will follow. All of it happens on your own machine,
and none of your audio leaves the browser.

> [!WARNING]
> Tacet is not on any extension store, and probably will not be. It works by
> capturing the audio YouTube Music is already streaming, which Chrome Web Store
> policy treats the same way it treats video downloaders. Load it unpacked.

> [!NOTE]
> Tacet is part of the [Better Lyrics](https://github.com/boidushya/better-lyrics)
> ecosystem. Although optional, it is **highly recommended** to use it alongside
> Better Lyrics and [Better Lyrics Shaders](https://github.com/better-lyrics/shaders):
> Tacet mounts its control straight into the Better Lyrics dock when that is
> installed, and the three are built to sit together in the same player.

## What it does

### Sing-along

Tacet splits the track into vocals and instrumental and gives you a vertical
slider between them. All the way down is karaoke. Anywhere in between is a guide
vocal. Tracks are separated ahead of you, so it is usually ready before
you reach for it, and stems are cached, so a song you have played before starts
instantly. Pause, seek and skip all stay in sync.

### Crossfade

One track blends into the next instead of stopping dead. It does not wait on
separation: with no stems to fade out of, the fade runs on the original audio.
Set the length in the popup, or turn it off there.

## Install

Download the zip from the [latest release](https://github.com/better-lyrics/tacet/releases/latest)
and unzip it. Open `chrome://extensions/`, turn on developer mode, click "Load
unpacked" and pick the `tacet` folder.

> [!NOTE]
> Loading unpacked is the only way in, and that is Chrome's doing rather than
> ours. Chrome has disabled sideloaded `.crx` files on Windows and macOS since
> 2014, and dropped `--load-extension` from stable builds in Chrome 137, so
> every other route now needs enterprise policy.

Or build it yourself:

```bash
git clone https://github.com/better-lyrics/tacet
cd tacet
npm install
npm run sync:ort
npm run build
```

That leaves the same folder at `build/chrome-mv3-prod` to load unpacked.

The first track fetches the separation model, which is a 163 MB one time
download. Sing-along can be switched off from the popup, which takes effect on
the next page load.

## Settings

The popup groups these under General, Separation and Storage.

| Setting | Default | What it does |
|---|---|---|
| Sing-along | on | Sing-along and everything behind it, crossfade included |
| Crossfade | 8s | Blends the end of one track into the start of the next |
| Sing-along position | Lyrics dock | Where the control sits when Better Lyrics is installed |
| Console logging | off | Prints what the extension is doing, for debugging |
| Start separating automatically | on | Gets each track ready before you reach for it |
| Model precision | Full | Half is a smaller download that sounds much the same |
| Cache budget | 250 MB | How many separated songs to keep |

## FAQ

### Does it work on Spotify, or anywhere other than YouTube Music?

No, and it never will. Every Better Lyrics extension is built on YouTube Music,
and that is deliberate rather than a starting point. Years have gone into
working out how that player actually behaves, between us and the other
developers who have worked on these, and we only ship things we understand at
that depth. A shallower version of this pointed at another service would be
worse than not shipping one at all.

### Why is there no Firefox version?

Tacet patches `SourceBuffer.appendBuffer` inside the page itself, before
YouTube Music's player exists, and then passes raw audio back and forth across
the page and extension boundary. Firefox wraps objects crossing that boundary in
Xray wrappers, and the hops Tacet is built on do not survive them. We looked at
it and stopped. It is not a packaging problem, so a Firefox manifest would not
fix it.

### Does any of my audio leave my machine?

No. The track is captured from what the page is already streaming, separated on
your own GPU, and cached in your own browser. The only thing Tacet fetches is
the separation model, once, from `models.betterlyrics.org`.

### Why is the first track so slow?

The separation model downloads the first time you need it. That is 163 MB, or
83 MB if you set Model precision to Half in the popup. It is kept afterwards, so
it happens once rather than once a track. After that each new song is separated
as it plays and the result is cached, so anything you have heard before starts
instantly.

### Do I need a GPU?

It asks for WebGPU first and falls back to CPU if that is unavailable, so it
will still work without one, just a lot slower.

### Do I need Better Lyrics?

No. With Better Lyrics installed the sing-along button docks into the lyrics
controls, and without it it sits in the player bar. Nothing else changes.

### Why did sing-along stop when I changed the playback speed?

Because stems cannot follow a speed change without going out of tune. YouTube
Music pitch corrects its own audio at 1.25x, but the stems are audio buffers
whose only speed control resamples them, so matching the rate would play them
sharp against a player that does not. At any speed other than 1x, Tacet stands
down and hands you the original audio.

### Does crossfade need separation?

No. If stems are ready it fades between those, and if not it fades the original
audio. It works with sing-along switched off entirely.

### Where do the separated songs live, and how do I clear them?

In IndexedDB in your browser, keyed by the audio itself rather than by video id.
The Storage tab in the popup shows how much room they take, sets the budget, and
clears either the stems or the model.

## How it works

The extension captures the audio the player is already streaming, decodes it,
and runs [htdemucs](https://github.com/adefossez/demucs) over it in an offscreen
document. The two stems come back as Opus, get cached in IndexedDB, and play
through a pair of gain nodes that follow the player's own transport. Sing-along
just moves those gains.

Crossfade needs the next track early, so Tacet fetches and decodes it before the
current one ends and lets the two overlap for a few seconds. If stems are ready
it fades between those. If not it fades the originals.

## Development

```bash
npm run dev        # Plasmo, with hot reload
npm run test       # vitest
npm run typecheck
npm run lint
```

Decisions live in small pure modules with tests beside them, and the Web Audio
and DOM work sits in thin wrappers around those. `window.blkKaraokeProbe()` in
the page console reports what actually reached Web Audio, which is the quickest
way to see what the graph is doing.

## Releasing

Run the [Release workflow](../../actions/workflows/release.yml) from the Actions
tab. It typechecks, lints, runs the tests, builds, tags the commit and drafts a
release with the zip attached. Three digits for a release (`1.2.0`), four for a
canary (`1.2.0.1`), which is published as a pre-release. The draft is left for
you to look over and publish.

## License

[GNU AGPL v3](LICENSE). Running a modified version over a network obliges you to
offer its source to the people using it.

## Acknowledgements

[htdemucs](https://github.com/adefossez/demucs) by Alexandre Défossez and
contributors does the separation. The ONNX export follows
[sevagh/demucs.onnx](https://github.com/sevagh/demucs.onnx).
