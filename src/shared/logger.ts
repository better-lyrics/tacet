const PREFIX = "[Tacet]";

let enabled = true;

interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function createLogger(scope?: string): Logger {
  const label = scope ? `${PREFIX}[${scope}]` : PREFIX;
  return {
    log: (...args: unknown[]) => {
      if (enabled) console.log(label, ...args);
    },
    warn: (...args: unknown[]) => {
      if (enabled) console.warn(label, ...args);
    },
    error: (...args: unknown[]) => console.error(label, ...args),
  };
}

function setLoggingEnabled(value: boolean): void {
  enabled = value;
}

export { createLogger, PREFIX, setLoggingEnabled };
export type { Logger };
