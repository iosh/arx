import { isUiProtocolError, isUiRemoteError, type UiRemoteError } from "@arx/core/ui";

export type WalletError = UiRemoteError;

/**
 * Type guard to check if error is a WalletError
 */
export const isWalletError = (error: unknown): error is WalletError => {
  return isUiRemoteError(error);
};

const getRemoteErrorMessage = (error: WalletError): string => {
  switch (error.code) {
    case "approval.rejected":
    case "approval.user_dismissed":
      return "Request rejected by user";
    case "approval.superseded":
      return "Request was replaced.";
    case "approval.cancelled":
      return "Request was cancelled.";
    case "global.session.locked":
    case "vault.locked":
      return "Wallet is locked. Please unlock first.";
    case "global.permission.not_connected":
      return "Not connected. Please connect first.";
    default:
      return error.message || "An unknown error occurred";
  }
};

export const getErrorMessage = (error: unknown): string => {
  if (isUiRemoteError(error)) {
    return getRemoteErrorMessage(error);
  }
  if (isUiProtocolError(error)) {
    return "Unexpected wallet response. Please try again.";
  }
  if (error instanceof Error) {
    return error.message || "An unknown error occurred";
  }
  return String(error ?? "An unknown error occurred");
};

export const isUserRejection = (error: unknown): boolean => {
  return isWalletError(error) && (error.code === "approval.rejected" || error.code === "approval.user_dismissed");
};

const getMessageText = (value: unknown) => {
  if (value instanceof Error) return value.message ?? "";
  if (typeof value === "string") return value;
  return "";
};

export const getUnlockErrorMessage = (error: unknown): string => {
  if (isUiRemoteError(error)) {
    if (error.code === "vault.invalid_password") {
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
  if (isUiRemoteError(error)) {
    return getErrorMessage(error);
  }
  const message = getMessageText(error).toLowerCase();
  if (message.includes("already initialized")) {
    return "Wallet is already initialized. Please unlock instead.";
  }
  return "Failed to initialize wallet. Please try again.";
};
