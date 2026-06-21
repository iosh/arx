export type WalletAvailability = "uninitialized" | "empty" | "ready";

export const isWalletInitialized = (availability: WalletAvailability | undefined): boolean => {
  return availability !== undefined && availability !== "uninitialized";
};

export const isWalletReady = (availability: WalletAvailability | undefined): boolean => {
  return availability === "ready";
};
