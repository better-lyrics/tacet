import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A second, weaker answer to a question that already has an owner is the most
// expensive mistake this codebase makes. Both clock faults that let the next
// queued track fade in midway were of that shape, and both were inside an owner
// rather than a bypass of one. These checks fail the build if a new one appears.

const ROOT = resolve(__dirname, "..");

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(path);
    }
  };
  walk(ROOT);
  return found;
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .filter(path => pattern.test(readFileSync(path, "utf8")))
    .map(path => relative(ROOT, path))
    .sort();
}

describe("one owner for how long the track is", () => {
  it("only the player snapshot combines the player bar clock with the player's own duration", () => {
    expect(filesMatching(/\bchooseTrackDuration\b/)).toEqual([
      "pageworld/player-state.ts",
      "pageworld/track-duration.ts",
    ]);
  });

  it("only the player snapshot decides whether that length can be trusted", () => {
    expect(filesMatching(/\bclocksAgree\b/)).toEqual(["pageworld/player-state.ts", "pageworld/track-duration.ts"]);
  });

  it("nothing outside the cue clock derives a remaining time by subtraction", () => {
    const derived = /duration(Seconds)?\s*-\s*[\w.]*[Pp]osition(Seconds)?/;
    expect(filesMatching(derived)).toEqual(["automix/cue-clock.ts"]);
  });
});

describe("one owner for how much of the track is left", () => {
  it("only the page world asks the cue clock, and only through its owner", () => {
    expect(filesMatching(/\bremainingForCue\b/)).toEqual(["automix/cue-clock.ts", "contents/inject-main-world.ts"]);
  });

  it("the deck's clock bounds a fade's length and answers nothing else", () => {
    expect(filesMatching(/\bfadeCeilingSeconds\b/)).toEqual(["automix/cue-clock.ts", "contents/inject-main-world.ts"]);
  });
});

describe("one owner for whether an ad is playing", () => {
  it("nothing reads the player's own ad flag, which is null during real ads", () => {
    expect(filesMatching(/isAd\s*===\s*true/)).toEqual(["pageworld/player-state.ts"]);
  });
});

describe("one owner for what is staged to fade into", () => {
  // Two owners, one per world: `Staging` holds what the page world can fade
  // into, `AheadStaging` holds the orchestrator's assembly of the ahead track's
  // Opus chunks. Neither keeps its state in loose variables any more.
  it("nothing keeps its own loose copy of what is staged", () => {
    expect(filesMatching(/\b(let|var)\s+staged[A-Z]/)).toEqual([]);
  });

  it("only the staging owner decides when what it holds is spent", () => {
    expect(filesMatching(/\bisStagingSpent\b/)).toEqual(["automix/staged-source.ts", "pageworld/staging.ts"]);
  });

  it("only the staging owner reaches the ready state, which is what arms a fade", () => {
    expect(filesMatching(/state:\s*"ready"/)).toEqual(["pageworld/staging.ts"]);
  });
});
