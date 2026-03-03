export const PROVIDER_EVENTS = {
  accountsChanged: "accountsChanged",
  chainChanged: "chainChanged",
  disconnect: "disconnect",
  metaChanged: "metaChanged",
  sessionLocked: "session:locked",
  sessionUnlocked: "session:unlocked",
} as const;

export type ProviderEventName = (typeof PROVIDER_EVENTS)[keyof typeof PROVIDER_EVENTS];
