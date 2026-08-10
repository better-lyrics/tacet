import { MAX_STEP_SECONDS, SPRING, createSpring, stepSpring } from "@/ui/spring";
import type { SpringDeps, SpringState } from "@/ui/spring";
import { describe, expect, it } from "vitest";

// -- Manual frame queue, no DOM, no timers -----------------------------------

function createManualFrameQueue() {
  let queued: Array<(time: number) => void> = [];
  let currentTime = 0;

  function requestAnimationFrame(callback: (time: number) => void): number {
    queued.push(callback);
    return queued.length;
  }

  function step(dtMs = 16): void {
    currentTime += dtMs;
    const callbacks = queued;
    queued = [];
    for (const callback of callbacks) callback(currentTime);
  }

  return {
    requestAnimationFrame,
    step,
    get pendingCount() {
      return queued.length;
    },
  };
}

function simulatePeak(target: number, dtSeconds: number, maxSteps: number): number {
  let state: SpringState = { x: 0, vel: 0 };
  let peak = 0;
  for (let i = 0; i < maxSteps; i++) {
    const stepped = stepSpring(state, target, SPRING, dtSeconds);
    state = { x: stepped.x, vel: stepped.vel };
    peak = Math.max(peak, state.x);
    if (stepped.settled) break;
  }
  return peak;
}

describe("stepSpring", () => {
  it("matches the mock's acceleration and integration formula for one step", () => {
    const state: SpringState = { x: 0, vel: 0 };
    const profile = SPRING;
    const dt = 0.01;
    const stepped = stepSpring(state, 1, profile, dt);
    const expectedVel = (0 + (-profile.stiffness * (0 - 1) - profile.damping * 0) * dt) as number;
    const expectedX = 0 + expectedVel * dt;
    expect(stepped.vel).toBeCloseTo(expectedVel, 10);
    expect(stepped.x).toBeCloseTo(expectedX, 10);
    expect(stepped.settled).toBe(false);
  });

  it("never integrates a step larger than 32ms", () => {
    const state: SpringState = { x: 0.2, vel: -0.5 };
    const clamped = stepSpring(state, 1, SPRING, MAX_STEP_SECONDS);
    const hugeDt = stepSpring(state, 1, SPRING, 5);
    expect(hugeDt.x).toBe(clamped.x);
    expect(hugeDt.vel).toBe(clamped.vel);
    expect(hugeDt.settled).toBe(clamped.settled);
  });

  it("settles exactly at the target with zero velocity", () => {
    let state: SpringState = { x: 0, vel: 0 };
    let settled = false;
    for (let i = 0; i < 5000 && !settled; i++) {
      const stepped = stepSpring(state, 1, SPRING, 1 / 240);
      state = { x: stepped.x, vel: stepped.vel };
      settled = stepped.settled;
    }
    expect(settled).toBe(true);
    expect(state.x).toBe(1);
    expect(state.vel).toBe(0);
  });

  describe("regressions", () => {
    it("overshoots by roughly 9% (damping ratio ~0.60)", () => {
      const peak = simulatePeak(1, 1 / 240, 5000);
      expect(peak).toBeGreaterThan(1.04);
      expect(peak).toBeLessThan(1.14);
    });

    it("converges on a held target at the largest step it will ever integrate", () => {
      let state: SpringState = { x: 0, vel: 0 };
      let peak = 0;
      for (let i = 0; i < 500; i++) {
        const stepped = stepSpring(state, -0.5, SPRING, MAX_STEP_SECONDS);
        state = { x: stepped.x, vel: stepped.vel };
        peak = Math.max(peak, Math.abs(state.x));
        if (stepped.settled) break;
      }
      expect(peak).toBeLessThanOrEqual(1);
      expect(state.x).toBeCloseTo(-0.5, 3);
    });
  });

  describe("invariants", () => {
    it("is a pure function: identical inputs produce identical outputs", () => {
      const state: SpringState = { x: 0.37, vel: 1.2 };
      const a = stepSpring(state, -1, SPRING, 0.016);
      const b = stepSpring(state, -1, SPRING, 0.016);
      expect(a).toEqual(b);
      expect(state).toEqual({ x: 0.37, vel: 1.2 });
    });

    it("does not mutate the input state object", () => {
      const state: SpringState = { x: 0, vel: 0 };
      const frozen = Object.freeze({ ...state });
      expect(() => stepSpring(frozen, 1, SPRING, 0.016)).not.toThrow();
    });
  });
});

describe("createSpring", () => {
  function makeDeps(queue: ReturnType<typeof createManualFrameQueue>, reduced = false): SpringDeps {
    return {
      requestAnimationFrame: queue.requestAnimationFrame,
      prefersReducedMotion: () => reduced,
    };
  }

  it("jump sets position instantly with no scheduled frame", () => {
    const queue = createManualFrameQueue();
    const frames: number[] = [];
    const spring = createSpring(x => frames.push(x), makeDeps(queue));
    spring.jump(0.5);
    expect(frames).toEqual([0.5]);
    expect(queue.pendingCount).toBe(0);
  });

  it("set schedules a frame and animates toward the target", () => {
    const queue = createManualFrameQueue();
    const frames: number[] = [];
    const spring = createSpring(x => frames.push(x), makeDeps(queue));
    spring.set(1);
    expect(queue.pendingCount).toBe(1);
    queue.step(16);
    expect(frames.length).toBe(1);
    expect(frames[0]).toBeGreaterThan(0);
    expect(frames[0]).toBeLessThan(1);
  });

  it("settles at the target and stops requesting frames", () => {
    const queue = createManualFrameQueue();
    const frames: number[] = [];
    const spring = createSpring(x => frames.push(x), makeDeps(queue));
    spring.set(1);
    for (let i = 0; i < 200 && queue.pendingCount > 0; i++) queue.step(16);
    expect(queue.pendingCount).toBe(0);
    expect(frames.at(-1)).toBe(1);
  });

  describe("regressions", () => {
    it("grabbing the handle mid-flight retargets instead of restarting", () => {
      const queue = createManualFrameQueue();
      const frames: number[] = [];
      const spring = createSpring(x => frames.push(x), makeDeps(queue));

      spring.set(1);
      for (let i = 0; i < 5; i++) queue.step(16);
      const midFlightX = frames.at(-1) as number;
      expect(midFlightX).toBeGreaterThan(0);
      expect(midFlightX).toBeLessThan(1);

      // A single frame is still pending; retargeting must not queue a second one.
      expect(queue.pendingCount).toBe(1);
      spring.set(-1);
      expect(queue.pendingCount).toBe(1);

      queue.step(16);
      const nextX = frames.at(-1) as number;
      expect(nextX).not.toBe(-1);

      const asIfRestarted = stepSpring({ x: midFlightX, vel: 0 }, -1, SPRING, 0.016).x;
      expect(nextX).not.toBeCloseTo(asIfRestarted, 5);
    });

    it("reduced motion snaps synchronously without ever scheduling a frame", () => {
      const queue = createManualFrameQueue();
      const frames: number[] = [];
      const spring = createSpring(x => frames.push(x), makeDeps(queue, true));
      spring.set(1);
      spring.set(-1);
      expect(frames).toEqual([1, -1]);
      expect(queue.pendingCount).toBe(0);
    });
  });
});
