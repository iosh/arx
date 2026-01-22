import { type ArxReason, ArxReasons } from "@arx/core";

export type WalletError = Error & {
  reason?: ArxReason;
  data?: unknown;
};

/**
 * Type guard to check if error is a WalletError
 */
export const isWalletError = (error: unknown): error is WalletError => {
  return error instanceof Error && typeof (error as WalletError).reason === "string";
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const walletError = error as WalletError;
    switch (walletError.reason) {
      case ArxReasons.ApprovalRejected:
        return "Request rejected by user";
      case ArxReasons.SessionLocked:
      case ArxReasons.VaultLocked:
        return "Wallet is locked. Please unlock first.";
      case ArxReasons.PermissionNotConnected:
        return "Not connected. Please connect first.";
      case ArxReasons.RpcMethodNotFound:
        return "Unsupported method";
      default:
        return walletError.message || "An unknown error occurred";
    }
  }
  return String(error ?? "An unknown error occurred");
};

export const isUserRejection = (error: unknown): boolean => {
  return isWalletError(error) && error.reason === ArxReasons.ApprovalRejected;
};

const getMessageText = (value: unknown) => {
  if (value instanceof Error) return value.message ?? "";
  if (typeof value === "string") return value;
  return "";
};

export const getUnlockErrorMessage = (error: unknown): string => {
  const walletError = error as WalletError | undefined;
  if (walletError?.reason) {
    if (walletError.reason === ArxReasons.VaultInvalidPassword) {
      return "Incorrect password. Please try again.";
    }
    return getErrorMessage(error);
  }
  const message = getMessageText(error).toLowerCase();
  if (message.includes("invalid password") || message.includes("incorrect password")) {
    return "Incorrect password. Please try again.";
  }
  return "Unable to unlock wallet. Please try again.";
};

export const getInitErrorMessage = (error: unknown): string => {
  const walletError = error as WalletError | undefined;
  if (walletError?.reason) {
    return getErrorMessage(error);
  }
  const message = getMessageText(error).toLowerCase();
  if (message.includes("already initialized")) {
    return "Wallet is already initialized. Please unlock instead.";
  }
  return "Failed to initialize wallet. Please try again.";
};
