// -- The best audio a session is actually offered --------------------------------

interface ChosenAudioFormat {
  itag: number;
  contentLengthBytes: number | null;
  bitrate: number;
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isAudioFormat(format: unknown): boolean {
  return String((format as { mimeType?: unknown })?.mimeType ?? "").startsWith("audio");
}

function readFormat(format: unknown): ChosenAudioFormat | null {
  const itag = readNumber((format as { itag?: unknown })?.itag);
  if (itag === null) return null;
  const record = format as { bitrate?: unknown; averageBitrate?: unknown; contentLength?: unknown };
  return {
    itag,
    contentLengthBytes: readNumber(record.contentLength),
    bitrate: readNumber(record.bitrate) ?? readNumber(record.averageBitrate) ?? 0,
  };
}

function chooseBestAudioFormat(formats: unknown): ChosenAudioFormat | null {
  if (!Array.isArray(formats)) return null;
  let best: ChosenAudioFormat | null = null;
  for (const format of formats) {
    if (!isAudioFormat(format)) continue;
    const read = readFormat(format);
    if (read === null) continue;
    if (best === null || read.bitrate > best.bitrate || (read.bitrate === best.bitrate && read.itag > best.itag)) {
      best = read;
    }
  }
  return best;
}

export { chooseBestAudioFormat, isAudioFormat };
export type { ChosenAudioFormat };
