export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<
  string,
  string | number | boolean | null | undefined
>;

export function createLogger(namespace: string) {
  return {
    debug: (message: string, context: LogContext = {}) => {
      console.debug(`[${namespace}] ${message}`, context);
    },
    info: (message: string, context: LogContext = {}) => {
      console.info(`[${namespace}] ${message}`, context);
    },
    warn: (message: string, context: LogContext = {}) => {
      console.warn(`[${namespace}] ${message}`, context);
    },
    error: (message: string, context: LogContext = {}) => {
      console.error(`[${namespace}] ${message}`, context);
    },
  };
}

export const logger = createLogger("app");
