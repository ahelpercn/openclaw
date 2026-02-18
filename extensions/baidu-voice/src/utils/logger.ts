/**
 * Logger utility
 */

export const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(`[INFO] [Baidu Voice] ${message}`, ...args);
  },

  warn: (message: string, ...args: any[]) => {
    console.warn(`[WARN] [Baidu Voice] ${message}`, ...args);
  },

  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] [Baidu Voice] ${message}`, ...args);
  },

  debug: (message: string, ...args: any[]) => {
    if (process.env.DEBUG === "true") {
      console.debug(`[DEBUG] [Baidu Voice] ${message}`, ...args);
    }
  },
};
