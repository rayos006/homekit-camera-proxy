const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
const threshold = LEVELS.includes(configured) ? LEVELS.indexOf(configured) : 1;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

function write(level: LogLevel, component: string, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS.indexOf(level) < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...fields,
  });
  process.stdout.write(line + "\n");
}

export function createLogger(component: string): Logger {
  return {
    debug: (msg, fields) => write("debug", component, msg, fields),
    info: (msg, fields) => write("info", component, msg, fields),
    warn: (msg, fields) => write("warn", component, msg, fields),
    error: (msg, fields) => write("error", component, msg, fields),
  };
}
