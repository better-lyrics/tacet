// -- What the track coming next is doing ---------------------------------------

type AheadActivity = "queued" | "downloading" | "separating" | "ready" | "unavailable";

const ORDER: Record<AheadActivity, number> = {
  queued: 0,
  downloading: 1,
  separating: 2,
  ready: 3,
  unavailable: 3,
};

function isAheadActivity(value: unknown): value is AheadActivity {
  return typeof value === "string" && value in ORDER;
}

function advanceAhead(current: AheadActivity | null, next: AheadActivity): AheadActivity {
  if (current === null) return next;
  return ORDER[next] >= ORDER[current] ? next : current;
}

const LABELS: Record<AheadActivity, string> = {
  queued: "Queued",
  downloading: "Downloading",
  separating: "Separating",
  ready: "Ready",
  unavailable: "Unavailable",
};

function withPercent(label: string, fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return label;
  return `${label} ${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

function describeAhead(activity: AheadActivity | null, fraction: number | null, cached: boolean | null): string {
  if (activity === null) return cached === null ? "" : cached ? LABELS.ready : LABELS.queued;
  if (activity === "downloading" || activity === "separating") return withPercent(LABELS[activity], fraction);
  return LABELS[activity];
}

export { advanceAhead, describeAhead, isAheadActivity };
export type { AheadActivity };
