import {
  POPUP_TABS,
  activePanel,
  initialView,
  isStatusVisible,
  isTabBarVisible,
  selectTab,
  toggleAbout,
} from "@/settings/popup-tabs";
import { describe, expect, it } from "vitest";

describe("popup tabs", () => {
  describe("happy path", () => {
    it("opens on the general tab with About closed", () => {
      expect(initialView()).toEqual({ tab: "general", aboutOpen: false });
    });

    it("selects a tab", () => {
      expect(selectTab(initialView(), "storage").tab).toBe("storage");
    });

    it("opens and closes About", () => {
      const opened = toggleAbout(initialView());
      expect(opened.aboutOpen).toBe(true);
      expect(toggleAbout(opened).aboutOpen).toBe(false);
    });

    it("names the panel to render", () => {
      expect(activePanel(initialView())).toBe("general");
      expect(activePanel(toggleAbout(initialView()))).toBe("about");
    });
  });

  describe("edge cases", () => {
    it("selecting the tab already shown is a no-op on the tab", () => {
      const view = selectTab(initialView(), "general");
      expect(view.tab).toBe("general");
    });

    it("every tab can be selected", () => {
      for (const tab of POPUP_TABS) {
        expect(selectTab(initialView(), tab).tab).toBe(tab);
      }
    });
  });

  describe("invariants", () => {
    it("never mutates the view it is given", () => {
      const view = initialView();
      selectTab(view, "storage");
      toggleAbout(view);
      expect(view).toEqual({ tab: "general", aboutOpen: false });
    });

    it("the tab bar is visible exactly when About is closed", () => {
      for (const tab of POPUP_TABS) {
        const view = selectTab(initialView(), tab);
        expect(isTabBarVisible(view)).toBe(true);
        expect(isTabBarVisible(toggleAbout(view))).toBe(false);
      }
    });

    it("what is playing is visible exactly when About is closed", () => {
      for (const tab of POPUP_TABS) {
        const view = selectTab(initialView(), tab);
        expect(isStatusVisible(view)).toBe(true);
        expect(isStatusVisible(toggleAbout(view))).toBe(false);
      }
    });

    it("toggling About twice returns the original view", () => {
      const view = selectTab(initialView(), "separation");
      expect(toggleAbout(toggleAbout(view))).toEqual(view);
    });
  });

  describe("regressions", () => {
    it("regression: picking a tab while About is open leaves About", () => {
      const view = toggleAbout(selectTab(initialView(), "storage"));
      expect(view.aboutOpen).toBe(true);
      const next = selectTab(view, "separation");
      expect(next).toEqual({ tab: "separation", aboutOpen: false });
    });

    it("regression: closing About returns to the tab that was showing", () => {
      const view = selectTab(initialView(), "storage");
      expect(toggleAbout(toggleAbout(view)).tab).toBe("storage");
    });
  });
});
