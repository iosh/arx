import type { AccountGroup, AccountId } from "@arx/core/accounts";
import type { KeySourceId } from "@arx/core/keyring";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

type CreationTarget = Readonly<{ keySourceId: KeySourceId; walletName: string }>;
type MoveCandidate = Readonly<{ account: AccountGroup; accountId: AccountId; target: CreationTarget }>;

export function useAccountCreation(onComplete?: () => void) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const creation = useWalletMutation({
    mutationFn: ({ keySourceId }: CreationTarget) => wallet.accounts.create({ keySourceId }),
  });
  const moving = useWalletMutation({
    mutationFn: wallet.accounts.move,
    toasterId: "account-move",
  });
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const candidate: MoveCandidate | null =
    creation.isSuccess && creation.data.status === "move-available"
      ? { account: creation.data.account, accountId: creation.data.accountId, target: creation.variables }
      : null;

  function complete() {
    creation.reset();
    onComplete?.();
  }

  function create(target: CreationTarget, button: HTMLElement) {
    returnFocusRef.current = button;
    toast.dismiss();
    creation.mutate(target, {
      onSuccess: (result) => {
        if (result.status === "created") {
          toast.success(t("accountCreated"));
          complete();
        }
      },
    });
  }

  function move({ accountId, target }: MoveCandidate) {
    toast.dismiss();
    moving.mutate(
      { accountId, keySourceId: target.keySourceId },
      {
        onSuccess: (movedAccount) => {
          toast.success(
            t("accountMoved", {
              accountName: getAccountName(movedAccount, t),
              walletName: target.walletName,
            }),
          );
          complete();
        },
      },
    );
  }

  return {
    isPending: creation.isPending || moving.isPending,
    creatingSourceId: creation.isPending ? creation.variables.keySourceId : null,
    candidate,
    returnFocusRef,
    create,
    move,
    cancel: creation.reset,
  };
}
