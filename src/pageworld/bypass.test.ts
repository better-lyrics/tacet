import { createBypassController } from "@/pageworld/bypass";
import { describe, expect, it, vi } from "vitest";

function createHarness() {
  const restoreOriginal = vi.fn();
  const stopStems = vi.fn();
  const controller = createBypassController({ restoreOriginal, stopStems });
  return { controller, restoreOriginal, stopStems };
}

describe("createBypassController", () => {
  it("starts bypassed: the shared source begins connected and untouched", () => {
    const { controller } = createHarness();
    expect(controller.isBypassed()).toBe(true);
  });

  it("entering bypass from an engaged state reconnects the destination and stops stems", () => {
    const { controller, restoreOriginal, stopStems } = createHarness();
    controller.exitBypass();
    expect(controller.isBypassed()).toBe(false);

    controller.enterBypass();
    expect(controller.isBypassed()).toBe(true);
    expect(restoreOriginal).toHaveBeenCalledTimes(1);
    expect(stopStems).toHaveBeenCalledTimes(1);
  });

  it("entering bypass while already bypassed does nothing (no-op, not a fresh reconnect)", () => {
    const { controller, restoreOriginal, stopStems } = createHarness();
    controller.enterBypass();
    expect(restoreOriginal).not.toHaveBeenCalled();
    expect(stopStems).not.toHaveBeenCalled();
  });

  describe("regressions", () => {
    it("bypass is idempotent: calling enterBypass twice in a row only fires the effects once", () => {
      const { controller, restoreOriginal, stopStems } = createHarness();
      controller.exitBypass();
      controller.enterBypass();
      controller.enterBypass();
      controller.enterBypass();
      expect(restoreOriginal).toHaveBeenCalledTimes(1);
      expect(stopStems).toHaveBeenCalledTimes(1);
    });

    it("a watchdog firing after a user-triggered stop does not double-reconnect", () => {
      const { controller, restoreOriginal } = createHarness();
      controller.exitBypass();
      controller.enterBypass();
      controller.enterBypass();
      expect(restoreOriginal).toHaveBeenCalledTimes(1);
    });
  });

  describe("invariants", () => {
    it("exitBypass then enterBypass then exitBypass again re-arms the effects for a second cycle", () => {
      const { controller, restoreOriginal, stopStems } = createHarness();
      controller.exitBypass();
      controller.enterBypass();
      controller.exitBypass();
      controller.enterBypass();
      expect(restoreOriginal).toHaveBeenCalledTimes(2);
      expect(stopStems).toHaveBeenCalledTimes(2);
    });

    it("exitBypass alone never calls the side-effect deps", () => {
      const { controller, restoreOriginal, stopStems } = createHarness();
      controller.exitBypass();
      controller.exitBypass();
      expect(restoreOriginal).not.toHaveBeenCalled();
      expect(stopStems).not.toHaveBeenCalled();
    });
  });
});
