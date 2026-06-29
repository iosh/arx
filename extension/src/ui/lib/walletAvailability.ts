export type WalletAvailability = "uninitialized" | "ready";

export const isWalletInitialized = (availability: WalletAvailability | undefined): boolean => {
  return availability === "ready";
};

export const isWalletReady = (availability: WalletAvailability | undefined): boolean => {
  return availability === "ready";
};
