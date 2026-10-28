import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** Report unexpected failures from a flow that is still active. */
export function useWalletError() {
  const { t } = useTranslation("wallet");
  return (error: unknown, toasterId?: string) => {
    console.error("[arx:ui] Wallet operation failed", error);
    toast.error(t("operationFailed"), { duration: Infinity, closeButton: true, toasterId });
  };
}
