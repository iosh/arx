export const common = {
  language: "Language",
  evmNetworks: "EVM networks",
  reload: "Reload",
  showPassword: "Show {{field}}",
  hidePassword: "Hide {{field}}",
  starting: "Starting ARX",
  pageUnavailable: "Unable to display this page",
} as const;

export type CommonMessages = Record<keyof typeof common, string>;
