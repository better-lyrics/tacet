<p align="center">
  <img src="assets/brand/logo.png" alt="Tacet" height="96" />
</p>

<h1 align="center">Tacet</h1>

<p align="center">
  Vocal separation for YouTube Music, running entirely in your browser.
</p>

<p align="center">
  <a href="https://github.com/better-lyrics/tacet/releases/latest"><img src="https://img.shields.io/github/v/release/better-lyrics/tacet?include_prereleases&label=release&color=black" alt="Latest release" /></a>
  <a href="https://github.com/better-lyrics/tacet/releases"><img src="https://img.shields.io/github/downloads/better-lyrics/tacet/total?label=downloads&color=black" alt="Downloads" /></a>
  <a href="https://github.com/better-lyrics/tacet/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/better-lyrics/tacet/release.yml?label=build&color=black" alt="Build" /></a>
</p>

Tacet splits whatever you are listening to into vocals and instrumental, then
gives you a fader that runs from the song as recorded down to the instrumental
on its own. Take the vocal all the way out for karaoke, or stop part way and
keep a guide vocal under you. It runs
[htdemucs](https://github.com/adefossez/demucs) on WebGPU, so your music never
leaves your machine.

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

## Features

- A vertical fader that takes the vocal down, all the way out, or anywhere in between
- Separation happens on your machine, on the GPU, with nothing uploaded
- Tracks are separated ahead of you, so the fader is usually ready before you reach for it
- Stems are cached, so a song you have played before is instant
- Follows the player: pause, seek and skip all stay in sync

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

The first track fetches the separation model, which is a 170 MB one time
download. Sing-along can be switched off from the popup, which takes effect on
the next page load.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Sing-along | on | The master switch |
| Separate automatically | on | Gets each track ready before you touch the fader |
| Cache budget | 250 MB | How many separated songs to keep |

## How it works

The extension captures the audio the player is already streaming, decodes it,
and runs htdemucs over it in an offscreen document. The two stems come back as
Opus, get cached in IndexedDB, and play through a pair of gain nodes that follow
the player's own transport. The fader just moves those gains.

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
