export const common = {
  language: "Language",
  retry: "Retry",
} as const;

export type CommonMessages = Record<keyof typeof common, string>;
