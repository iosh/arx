import { AccountRemovalSelectionUnavailableError } from "@arx/core/accounts";
import { type KeySourceId, KeySourceNotFoundError } from "@arx/core/keyring";
import { WalletLastKeySourceRemovalError } from "@arx/core/wallet";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

export function useKeySourceRemoval() {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const navigate = useNavigate();
  const reportError = useWalletError();
  const removal = useWalletMutation({ mutationFn: wallet.keySources.remove, gcTime: 0 });

  function removeKeySource(keySourceId: KeySourceId, name: string) {
    toast.dismiss();
    removal.mutate(
      { keySourceId },
      {
        onSuccess: () => {
          toast.success(t("keySourceRemoved", { name }));
          void navigate({ to: "/wallet/accounts", replace: true });
        },
        onError: (error) => {
          if (
            isWalletApiError(error, WalletLastKeySourceRemovalError) ||
            isWalletApiError(error, AccountRemovalSelectionUnavailableError)
          ) {
            toast.error(t("lastAccountRemoval"), {
              toasterId: "key-source-removal",
              duration: Infinity,
              closeButton: true,
            });
            return;
          }
          // A removed or moved source also removes its confirmation sheet.
          reportError(error, isWalletApiError(error, KeySourceNotFoundError) ? undefined : "key-source-removal");
        },
      },
    );
  }

  return { isPending: removal.isPending, removeKeySource };
}
