import type { Account } from "@arx/core/accounts";
import type { HdKeyringId } from "@arx/core/keyring";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

type CreationTarget = Readonly<{ hdKeyringId: HdKeyringId; walletName: string }>;
type MoveCandidate = Readonly<{ account: Account; target: CreationTarget }>;

export function useAccountCreation(onComplete?: () => void) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const creation = useWalletMutation({
    mutationFn: ({ hdKeyringId }: CreationTarget) => wallet.accounts.create({ hdKeyringId }),
  });
  const moving = useWalletMutation({
    mutationFn: wallet.accounts.move,
    toasterId: "account-move",
  });
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const candidate: MoveCandidate | null =
    creation.isSuccess && creation.data.status === "move-available"
      ? { account: creation.data.account, target: creation.variables }
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

  function move({ account, target }: MoveCandidate) {
    toast.dismiss();
    moving.mutate(
      { accountId: account.accountId, hdKeyringId: target.hdKeyringId },
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
    creatingKeyringId: creation.isPending ? creation.variables.hdKeyringId : null,
    candidate,
    returnFocusRef,
    create,
    move,
    cancel: creation.reset,
  };
}
