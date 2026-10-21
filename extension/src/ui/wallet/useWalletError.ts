import { isWalletApiError, WalletChannelDisconnectedError } from "@arx/wallet-api/client";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function useWalletError() {
  const { t } = useTranslation("wallet");

  return useCallback(
    (error: unknown, toasterId?: string) => {
      console.error("[arx:ui] Wallet operation failed", error);
      const message = t(
        isWalletApiError(error, WalletChannelDisconnectedError) ? "operationDisconnected" : "operationFailed",
      );
      toast.error(message, { duration: Infinity, closeButton: true, toasterId });
    },
    [t],
  );
}
