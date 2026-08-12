import { createTrackStatusStore } from "@/orchestrator/track-status";

// -- The tab's single status record --------------------------------------------

const trackStatusStore = createTrackStatusStore();

export { trackStatusStore };
