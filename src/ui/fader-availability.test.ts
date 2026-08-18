import { describe, expect, it } from "vitest";
import { type FaderAvailability, faderMarks } from "@/ui/fader-availability";

const ALL: FaderAvailability[] = ["available", "inert", "unavailable"];

describe("faderMarks", () => {
  it("leaves a live fader enabled and unstyled", () => {
    expect(faderMarks("available")).toEqual({ ariaDisabled: false, opacity: "", filter: "", cursor: "" });
  });

  it("marks an inert fader disabled without taking its colour", () => {
    expect(faderMarks("inert")).toEqual({ ariaDisabled: true, opacity: "", filter: "", cursor: "" });
  });

  it("dims a fader whose separation failed", () => {
    expect(faderMarks("unavailable")).toEqual({
      ariaDisabled: true,
      opacity: "0.45",
      filter: "grayscale(70%)",
      cursor: "not-allowed",
    });
  });

  describe("invariants", () => {
    it("only the live fader reports itself enabled", () => {
      for (const availability of ALL) {
        expect(faderMarks(availability).ariaDisabled).toBe(availability !== "available");
      }
    });

    it("only the failed fader is dimmed", () => {
      for (const availability of ALL) {
        const marks = faderMarks(availability);
        expect(marks.opacity === "" && marks.filter === "").toBe(availability !== "unavailable");
      }
    });

    it("answers the same marks however many times it is asked", () => {
      for (const availability of ALL) {
        expect(faderMarks(availability)).toEqual(faderMarks(availability));
        expect(faderMarks(availability)).toEqual(faderMarks(availability));
      }
    });
  });

  describe("regressions", () => {
    it("regression: an inert fader stays marked disabled instead of reading as enabled", () => {
      const repeated = [faderMarks("inert"), faderMarks("inert"), faderMarks("inert")];
      for (const marks of repeated) expect(marks.ariaDisabled).toBe(true);
    });

    it("regression: going inert from a failed state clears the dimming but keeps the disabled mark", () => {
      const failed = faderMarks("unavailable");
      const inert = faderMarks("inert");
      expect(failed.opacity).not.toBe("");
      expect(inert.opacity).toBe("");
      expect(inert.filter).toBe("");
      expect(inert.ariaDisabled).toBe(true);
    });
  });
});
