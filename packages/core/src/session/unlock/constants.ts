// Centralized auto-lock configuration (milliseconds).
// Keep these constants in one place to avoid UI/runtime/schema drift.

export const DEFAULT_AUTO_LOCK_MS = 15 * 60 * 1000;
export const MIN_AUTO_LOCK_MS = 60_000; // 1 minute
export const MAX_AUTO_LOCK_MS = 60 * 60_000; // 60 minutes
