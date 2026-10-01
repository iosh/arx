export const common = {
  language: "Language",
  retry: "Retry",
  starting: "Starting ARX",
  startupFailed: "ARX could not start",
  startupFailedDescription: "If retrying does not help, restart your browser.",
} as const;

export type CommonMessages = Record<keyof typeof common, string>;
