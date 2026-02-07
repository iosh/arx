import debug, { type Debugger } from "debug";

const DEFAULT_PREFIX = "arx";

/**
 * Create a namespaced debug logger that shares the global enable/disable switch.
 * Use localStorage.debug or DEBUG env var to control visibility.
 */
export const createLogger = (namespace: string, options?: { prefix?: string }): Debugger => {
  const prefix = options?.prefix ?? DEFAULT_PREFIX;
  return debug(`${prefix}:${namespace}`);
};

/**
 * Helper to extend an existing logger with additional namespace suffix.
 */
export const extendLogger = (logger: Debugger, suffix: string): Debugger => {
  return typeof logger.extend === "function" ? logger.extend(suffix) : createLogger(`${logger.namespace}:${suffix}`);
};

/**
 * Enable/disable debug namespaces programmatically.
 * Note: MV3 backgrounds don't reliably expose localStorage, so env-driven enablement
 * should happen at runtime via these helpers.
 */
export const enableDebugNamespaces = (namespaces: string) => debug.enable(namespaces);
export const disableDebugNamespaces = () => debug.disable();
