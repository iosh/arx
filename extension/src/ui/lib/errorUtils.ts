export type WalletError = Error & {
  code?: number;
  data?: unknown;
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const walletError = error as WalletError;
    switch (walletError.code) {
      case 4001:
        return "Request rejected by user";
      case 4100:
        return "Wallet is locked. Please unlock first.";
      case 4200:
        return "Unsupported method";
      case 4900:
        return "Connection lost. Please try again.";
      case 4901:
        return "Chain not connected";
      default:
        return walletError.message || "An unknown error occurred";
    }
  }
  return String(error ?? "An unknown error occurred");
};

export const isUserRejection = (error: unknown): boolean => {
  return Boolean((error as WalletError)?.code === 4001);
};
