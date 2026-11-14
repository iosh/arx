import { isWalletApiError, WalletChannelDisconnectedError } from "@arx/wallet-api/client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** Report unexpected failures from a flow that is still active. */
export function useWalletError() {
  const { t } = useTranslation("wallet");
  return (error: unknown, toasterId?: string) => {
    console.error("[arx:ui] Wallet operation failed", error);
    const message = isWalletApiError(error, WalletChannelDisconnectedError)
      ? "operationOutcomeUnknown"
      : "operationFailed";
    toast.error(t(message), { duration: Infinity, closeButton: true, toasterId });
  };
}
