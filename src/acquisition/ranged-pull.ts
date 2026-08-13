// -- What a ranged pull is ------------------------------------------------------

interface ByteRange {
  start: number;
  end: number;
}

interface RangedResponse {
  status: number;
  bytes: Uint8Array;
}

type RangedTransport = (url: string, signal: AbortSignal) => Promise<RangedResponse>;

interface RangedPullInput {
  url: string;
  contentLengthBytes: number;
  send: RangedTransport;
  windowBytes?: number;
  concurrency?: number;
  attempts?: number;
  requestTimeoutMs?: number;
  maxRequests?: number;
  onProgress?: (receivedBytes: number, expectedBytes: number) => void;
}

interface RangedPullResult {
  ok: boolean;
  reason: string;
  bytes: Uint8Array<ArrayBuffer>;
  requests: number;
  redirects: number;
  retries: number;
  timeouts: number;
}

const DEFAULT_WINDOW_BYTES = 1_048_576;

const DEFAULT_CONCURRENCY = 4;

const DEFAULT_ATTEMPTS = 4;

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

const MAX_REDIRECTS = 4;

const RESPONSE_FRAMING_PARAMS = ["ump", "srfvp", "rbuf"] as const;

// -- Planning the windows -------------------------------------------------------

function planRanges(contentLengthBytes: number, windowBytes: number): ByteRange[] {
  if (!Number.isFinite(contentLengthBytes) || contentLengthBytes <= 0) return [];
  if (!Number.isFinite(windowBytes) || windowBytes <= 0) return [];
  const ranges: ByteRange[] = [];
  for (let start = 0; start < contentLengthBytes; start += windowBytes) {
    ranges.push({ start, end: Math.min(start + windowBytes - 1, contentLengthBytes - 1) });
  }
  return ranges;
}

// -- Addressing one window ------------------------------------------------------

function rangedUrl(url: string, range: ByteRange, requestNumber: number): string {
  const parsed = new URL(url);
  for (const name of RESPONSE_FRAMING_PARAMS) parsed.searchParams.delete(name);
  parsed.searchParams.set("range", `${range.start}-${range.end}`);
  parsed.searchParams.set("rn", String(requestNumber));
  return parsed.href;
}

// -- Telling a redirect from media ----------------------------------------------

const REDIRECT_PROBE_BYTES = 4096;

function readRedirect(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > REDIRECT_PROBE_BYTES) return null;
  const text = new TextDecoder().decode(bytes).trim();
  if (!/^https?:\/\/\S+$/.test(text)) return null;
  try {
    return new URL(text).href;
  } catch {
    return null;
  }
}

// -- Pulling --------------------------------------------------------------------

function refused(reason: string, counters: Omit<RangedPullResult, "ok" | "reason" | "bytes">): RangedPullResult {
  return { ok: false, reason, bytes: new Uint8Array(), ...counters };
}

async function pullRanged(input: RangedPullInput): Promise<RangedPullResult> {
  const windowBytes = input.windowBytes ?? DEFAULT_WINDOW_BYTES;
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY);
  const attempts = Math.max(1, input.attempts ?? DEFAULT_ATTEMPTS);
  const timeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let requests = 0;
  let redirects = 0;
  let retries = 0;
  let timeouts = 0;
  const counters = (): Omit<RangedPullResult, "ok" | "reason" | "bytes"> => ({
    requests,
    redirects,
    retries,
    timeouts,
  });

  const ranges = planRanges(input.contentLengthBytes, windowBytes);
  if (ranges.length === 0) return refused("that url states no length to pull", counters());
  if (input.maxRequests !== undefined && ranges.length > input.maxRequests) {
    return refused(`pulling it would take ${ranges.length} requests`, counters());
  }

  const ask = async (base: string, range: ByteRange): Promise<RangedResponse | "timeout"> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      requests += 1;
      return await input.send(rangedUrl(base, range, requests), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        timeouts += 1;
        return "timeout";
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  // A redirect answered per window would race every other worker, so it is
  // resolved once against the first two bytes before any window is asked for.
  let base = input.url;
  const probe: ByteRange = { start: 0, end: 1 };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let answer: RangedResponse | "timeout";
    try {
      answer = await ask(base, probe);
    } catch (error) {
      return refused(`the first request failed: ${String(error)}`, counters());
    }
    if (answer === "timeout") return refused("the first request timed out", counters());
    if (answer.status !== 200) return refused(`the url answered http ${answer.status}`, counters());
    const moved = readRedirect(answer.bytes);
    if (moved === null) break;
    if (hop === MAX_REDIRECTS) return refused("the url kept redirecting", counters());
    base = moved;
    redirects += 1;
  }

  const chunks: (Uint8Array | undefined)[] = new Array(ranges.length);
  let received = 0;
  let refusal: string | null = null;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < ranges.length && refusal === null) {
      const index = cursor;
      cursor += 1;
      const range = ranges[index];
      const wanted = range.end - range.start + 1;
      let local = base;
      let why = "no attempt was made";

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) {
          retries += 1;
          await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
        }
        let answer: RangedResponse | "timeout";
        try {
          answer = await ask(local, range);
        } catch (error) {
          why = String(error);
          continue;
        }
        if (answer === "timeout") {
          why = "it timed out";
          continue;
        }
        if (answer.status !== 200) {
          why = `it answered http ${answer.status}`;
          continue;
        }
        const moved = readRedirect(answer.bytes);
        if (moved !== null) {
          local = moved;
          redirects += 1;
          why = "it redirected";
          continue;
        }
        if (answer.bytes.byteLength !== wanted) {
          why = `it served ${answer.bytes.byteLength} of ${wanted} bytes`;
          continue;
        }
        chunks[index] = answer.bytes;
        received += answer.bytes.byteLength;
        input.onProgress?.(received, input.contentLengthBytes);
        break;
      }

      if (chunks[index] === undefined) {
        refusal = `the pull stopped at byte ${range.start} after ${attempts} attempts, because ${why}`;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));

  if (refusal !== null) return refused(refusal, counters());
  if (received !== input.contentLengthBytes) {
    return refused(`the pull served ${received} of ${input.contentLengthBytes} bytes`, counters());
  }

  const bytes = new Uint8Array(new ArrayBuffer(received));
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk === undefined) continue;
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, reason: "the whole track arrived", bytes, ...counters() };
}

export {
  DEFAULT_ATTEMPTS,
  DEFAULT_CONCURRENCY,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_WINDOW_BYTES,
  MAX_REDIRECTS,
  planRanges,
  pullRanged,
  rangedUrl,
  readRedirect,
};
export type { ByteRange, RangedPullInput, RangedPullResult, RangedResponse, RangedTransport };
