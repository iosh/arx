export const common = {
  language: "Language",
  close: "Close",
  notifications: "Notifications",
  evmNetworks: "EVM networks",
  loadingNetwork: "Loading network",
  reload: "Reload",
  showPassword: "Show {{field}}",
  hidePassword: "Hide {{field}}",
  starting: "Starting ARX",
  pageUnavailable: "Unable to display this page",
} as const;

export type CommonMessages = Record<keyof typeof common, string>;
