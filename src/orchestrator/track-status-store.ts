import { createTrackStatusStore } from "@/orchestrator/track-status";

// -- The tab's single status record --------------------------------------------
//
// Module scope rather than pipeline scope, because the section is about the
// queue and must survive sing-along being switched off.

const trackStatusStore = createTrackStatusStore();

export { trackStatusStore };
