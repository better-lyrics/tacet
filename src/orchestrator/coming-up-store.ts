import { createComingUpStore } from "@/orchestrator/coming-up";

// -- The tab's single Coming up record -----------------------------------------
//
// Module scope rather than pipeline scope, because the band is about the queue
// and must survive sing-along being switched off.

const comingUpStore = createComingUpStore();

export { comingUpStore };
