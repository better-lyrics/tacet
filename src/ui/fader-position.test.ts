import { CARD_GAP_PX } from "@/ui/fader-geometry";
import { computeCardPosition, opensDownFor } from "@/ui/fader-position";
import { describe, expect, it } from "vitest";

const triggerRect = { left: 200, width: 28 };
const anchorRect = { top: 492, bottom: 536 };
const menuSize = { width: 68, height: 170 };
const viewport = { width: 1280, height: 800 };

describe("opensDownFor", () => {
  it("happy paths: top-prefixed positions open down, bottom-prefixed open up", () => {
    expect(opensDownFor("top-left")).toBe(true);
    expect(opensDownFor("top-center")).toBe(true);
    expect(opensDownFor("top-right")).toBe(true);
    expect(opensDownFor("bottom-left")).toBe(false);
    expect(opensDownFor("bottom-center")).toBe(false);
    expect(opensDownFor("bottom-right")).toBe(false);
  });

  describe("edge cases", () => {
    it("treats a missing data-position (player bar, no dock ancestor) as opens up", () => {
      expect(opensDownFor(null)).toBe(false);
    });

    it("treats an empty string the same as missing", () => {
      expect(opensDownFor("")).toBe(false);
    });
  });
});

describe("computeCardPosition", () => {
  it("centres the card on the trigger, the deliberate deviation from positionSourceMenu", () => {
    const position = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, "bottom-right");
    expect(position.left).toBe(180);
  });

  it("opens down when data-position starts with top, gap measured from the anchor", () => {
    const position = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, "top-right");
    expect(position.opensDown).toBe(true);
    expect(position.top).toBe(`${anchorRect.bottom + 8}px`);
    expect(position.bottom).toBe("");
  });

  it("opens up when data-position starts with bottom, gap measured from the anchor", () => {
    const position = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, "bottom-right");
    expect(position.opensDown).toBe(false);
    expect(position.bottom).toBe(`${viewport.height - anchorRect.top + 8}px`);
    expect(position.top).toBe("");
  });

  it("opens up when data-position is absent, matching the player bar with no dock ancestor", () => {
    const position = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, null);
    expect(position.opensDown).toBe(false);
  });

  describe("edge cases", () => {
    it("clamps to the 8px viewport edge when the trigger sits near the left edge", () => {
      const leftTrigger = { ...triggerRect, left: 0 };
      const position = computeCardPosition(leftTrigger, anchorRect, menuSize, viewport, "bottom-left");
      expect(position.left).toBe(8);
    });

    it("clamps to the 8px viewport edge when the trigger sits near the right edge", () => {
      const rightTrigger = { left: viewport.width - triggerRect.width, width: triggerRect.width };
      const position = computeCardPosition(rightTrigger, anchorRect, menuSize, viewport, "bottom-right");
      const maxLeft = viewport.width - menuSize.width - 8;
      expect(position.left).toBe(maxLeft);
      expect(position.left).toBeLessThan(rightTrigger.left);
    });

    it("falls back to the 8px edge, not a negative offset, when the menu is wider than the viewport", () => {
      const narrowViewport = { width: 40, height: 800 };
      const position = computeCardPosition(triggerRect, anchorRect, menuSize, narrowViewport, "bottom-right");
      expect(position.left).toBe(8);
    });
  });

  describe("regressions", () => {
    it("measures the gap from the anchor rect (dock pill), not the trigger (button)", () => {
      const widerAnchor = { top: 400, bottom: 460 };
      const position = computeCardPosition(triggerRect, widerAnchor, menuSize, viewport, "top-left");
      expect(position.top).toBe(`${widerAnchor.bottom + 8}px`);
      expect(position.top).not.toBe(`${triggerRect.width + 8}px`);
    });
  });

  describe("invariants", () => {
    it("is a pure function with no shared state between calls", () => {
      const a = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, "top-left");
      const b = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, "top-left");
      expect(a).toEqual(b);
    });

    it("exactly one of top/bottom is ever set, never both, never neither", () => {
      for (const dataPosition of ["top-left", "bottom-right", null]) {
        const position = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, dataPosition);
        expect(position.top === "" || position.bottom === "").toBe(true);
        expect(position.top !== "" || position.bottom !== "").toBe(true);
      }
    });
  });
});

describe("gap", () => {
  const triggerRect = { left: 500, width: 28 };
  const anchorRect = { top: 300, bottom: 340 };
  const menuSize = { width: 68, height: 120 };
  const viewport = { width: 1440, height: 900 };

  it("defaults to the fader card's own clearance", () => {
    const position = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, null);
    expect(position.bottom).toBe(`${900 - 300 + CARD_GAP_PX}px`);
  });

  it("applies a caller's gap to whichever edge the card opens from", () => {
    const up = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, null, 14);
    expect(up.opensDown).toBe(false);
    expect(up.bottom).toBe(`${900 - 300 + 14}px`);

    const down = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, "top-right", 14);
    expect(down.opensDown).toBe(true);
    expect(down.top).toBe(`${340 + 14}px`);
  });

  it("leaves the horizontal placement untouched", () => {
    const tight = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, null);
    const loose = computeCardPosition(triggerRect, anchorRect, menuSize, viewport, null, 14);
    expect(loose.left).toBe(tight.left);
  });
});
