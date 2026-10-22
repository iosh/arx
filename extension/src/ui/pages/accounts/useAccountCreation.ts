import type { Account } from "@arx/core/accounts";
import type { HdKeyringId } from "@arx/core/keyring";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { useCreateHdAccount, useMovePrivateKeyAccount } from "@/ui/wallet/keyring/useHdAccountMutations";
import { useWalletError } from "@/ui/wallet/useWalletError";

type CreationTarget = Readonly<{ hdKeyringId: HdKeyringId; walletName: string }>;
type MoveCandidate = Readonly<{ account: Account; target: CreationTarget }>;

export function useAccountCreation(onComplete?: () => void) {
  const { t } = useTranslation("wallet");
  const showError = useWalletError();
  const creation = useCreateHdAccount();
  const moving = useMovePrivateKeyAccount();
  const [target, setTarget] = useState<CreationTarget | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const candidate: MoveCandidate | null =
    target && creation.data?.status === "move-available" ? { account: creation.data.account, target } : null;

  function cancel() {
    creation.reset();
    setTarget(null);
  }

  function complete() {
    cancel();
    onComplete?.();
  }

  function create(nextTarget: CreationTarget, button: HTMLElement) {
    setTarget(nextTarget);
    returnFocusRef.current = button;
    toast.dismiss();
    creation.mutate(
      { hdKeyringId: nextTarget.hdKeyringId },
      {
        onSuccess: (result) => {
          if (result.status === "created") {
            toast.success(t("accountCreated"));
            complete();
          }
        },
        onError: (error) => showError(error),
      },
    );
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
        onError: (error) => showError(error, "account-move"),
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
    cancel,
  };
}
