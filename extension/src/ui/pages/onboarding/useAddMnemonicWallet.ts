import type { AccountGroup, AccountId } from "@arx/core/accounts";
import type { AddMnemonicSourceInput } from "@arx/core/wallet";
import { useBlocker } from "@tanstack/react-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useMnemonicSources } from "@/ui/wallet/keyring/useMnemonicSources";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

export type AddMnemonicWalletInput = Pick<AddMnemonicSourceInput, "mnemonic" | "backupStatus">;
export type AddMnemonicWalletContext = Readonly<{
  onAdded(): void;
}>;

type AdditionOptions = {
  onDuplicate?(walletName: string): void;
  onError?(error: unknown): void;
  returnFocusElement?: HTMLElement | null | undefined;
};

type MoveCandidate = Readonly<{ accountGroup: AccountGroup; accountId: AccountId; input: AddMnemonicSourceInput }>;

export function useAddMnemonicWallet({ onAdded }: AddMnemonicWalletContext) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const { data: sources } = useMnemonicSources();
  const addition = useWalletMutation({
    mutationFn: wallet.keySources.addMnemonic,
    gcTime: 0,
    toasterId: ({ backupStatus }) => (backupStatus === "pending" ? "defer-backup" : undefined),
  });
  const confirmation = useWalletMutation({
    mutationFn: wallet.keySources.addMnemonicAndMoveAccount,
    gcTime: 0,
    toasterId: "account-move",
  });
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useBlocker({ shouldBlockFn: () => confirmation.isPending, enableBeforeUnload: false });

  // False keeps the caller's form or deferred-backup confirmation open.
  async function add({ mnemonic, backupStatus }: AddMnemonicWalletInput, options: AdditionOptions) {
    if (!sources) return false;
    returnFocusRef.current =
      options.returnFocusElement ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    let number = sources.length + 1;
    let name = t("defaultWalletName", { number });
    while (sources.some((source) => source.name === name)) name = t("defaultWalletName", { number: ++number });

    const result = await addition.mutateAsync(
      { mnemonic, backupStatus, name },
      {
        onError: options.onError,
        onSuccess: (result) => {
          if (result.status === "added") onAdded();
          else if (result.status === "duplicate") options.onDuplicate?.(result.walletName);
        },
        onSettled: (result) => {
          if (result?.status !== "move-available") addition.reset();
        },
      },
    );
    return result.status === "added" || result.status === "move-available";
  }

  const candidate: MoveCandidate | null =
    addition.isSuccess && addition.data.status === "move-available"
      ? { accountGroup: addition.data.accountGroup, accountId: addition.data.accountId, input: addition.variables }
      : null;

  function confirmMove({ accountId, input }: MoveCandidate) {
    confirmation.mutate(
      { ...input, accountId },
      {
        onSuccess: onAdded,
        onSettled: confirmation.reset,
      },
    );
  }

  function cancelMove() {
    addition.reset();
    confirmation.reset();
  }

  const move = candidate
    ? {
        accountGroup: candidate.accountGroup,
        accountId: candidate.accountId,
        walletName: candidate.input.name,
        isPending: confirmation.isPending,
        confirm: () => confirmMove(candidate),
        cancel: cancelMove,
      }
    : null;

  return { add, canAdd: Boolean(sources) && !candidate, isAdding: addition.isPending, move, returnFocusRef };
}
