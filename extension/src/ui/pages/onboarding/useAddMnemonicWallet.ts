import type { Account } from "@arx/core/accounts";
import type { KeySource } from "@arx/core/keyring";
import type { Namespace } from "@arx/core/namespaces";
import type { AddMnemonicSourceInput } from "@arx/core/wallet";
import { useBlocker } from "@tanstack/react-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

export type AddMnemonicWalletInput = Pick<AddMnemonicSourceInput, "mnemonic" | "backupStatus">;
export type AddMnemonicWalletContext = Readonly<{
  sources: readonly Extract<KeySource, { type: "bip39" }>[];
  namespace: Namespace;
  onAdded(): void;
}>;

type AdditionOptions = {
  onDuplicate?(walletName: string): void;
  onError?(error: unknown): void;
  returnFocusElement?: HTMLElement | null | undefined;
};

type MoveCandidate = Readonly<{ account: Account; input: AddMnemonicSourceInput }>;

export function useAddMnemonicWallet({ sources, namespace, onAdded }: AddMnemonicWalletContext) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
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

  function add({ mnemonic, backupStatus }: AddMnemonicWalletInput, options: AdditionOptions) {
    returnFocusRef.current =
      options.returnFocusElement ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    let number = sources.length + 1;
    let name = t("defaultWalletName", { number });
    while (sources.some((source) => source.name === name)) name = t("defaultWalletName", { number: ++number });

    return addition.mutateAsync(
      { mnemonic, backupStatus, name, namespace },
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
  }

  const candidate: MoveCandidate | null =
    addition.isSuccess && addition.data.status === "move-available"
      ? { account: addition.data.account, input: addition.variables }
      : null;

  function confirmMove({ account, input }: MoveCandidate) {
    confirmation.mutate(
      { ...input, accountId: account.accountId },
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
        account: candidate.account,
        walletName: candidate.input.name,
        isPending: confirmation.isPending,
        confirm: () => confirmMove(candidate),
        cancel: cancelMove,
      }
    : null;

  return { add, isAdding: addition.isPending, move, returnFocusRef };
}
