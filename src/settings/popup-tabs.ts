// -- Which panel the popup is showing ------------------------------------------

const POPUP_TABS = ["general", "separation", "storage"] as const;

type PopupTab = (typeof POPUP_TABS)[number];

interface PopupView {
  tab: PopupTab;
  aboutOpen: boolean;
}

function initialView(): PopupView {
  return { tab: "general", aboutOpen: false };
}

// Picking a tab is a request to see that tab, so it leaves About rather than
// selecting underneath it.
function selectTab(_view: PopupView, tab: PopupTab): PopupView {
  return { tab, aboutOpen: false };
}

function toggleAbout(view: PopupView): PopupView {
  return { tab: view.tab, aboutOpen: !view.aboutOpen };
}

// The tab bar is not a valid place to be while About is open, so it goes with
// it and the panel reads as a level of its own.
function isTabBarVisible(view: PopupView): boolean {
  return !view.aboutOpen;
}

// What is playing belongs to the tabs rather than to About, so it goes with the
// tab bar.
function isStatusVisible(view: PopupView): boolean {
  return !view.aboutOpen;
}

function activePanel(view: PopupView): PopupTab | "about" {
  return view.aboutOpen ? "about" : view.tab;
}

export { POPUP_TABS, initialView, selectTab, toggleAbout, isTabBarVisible, isStatusVisible, activePanel };
export type { PopupTab, PopupView };
