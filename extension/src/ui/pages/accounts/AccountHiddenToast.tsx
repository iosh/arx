import type { AccountId } from "@arx/core/accounts";
import type { SetAccountHiddenResult } from "@arx/core/wallet";
import type { TFunction } from "i18next";
import { EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

export function showAccountHiddenToast(
  { account, replacementAccount }: SetAccountHiddenResult,
  t: TFunction<"wallet">,
) {
  const accountName = getAccountName(account, t);
  const message = replacementAccount
    ? t("accountHiddenAndSelected", { accountName, replacementName: getAccountName(replacementAccount, t) })
    : t("accountHidden", { accountName });
  const toastId = `hidden-account:${account.accountId}`;
  toast.success(message, {
    id: toastId,
    icon: <EyeOff aria-hidden="true" className="size-3.75" />,
    action: <UndoAccountHideButton accountId={account.accountId} toastId={toastId} message={message} />,
  });
}

function UndoAccountHideButton({
  accountId,
  toastId,
  message,
}: {
  accountId: AccountId;
  toastId: string | number;
  message: string;
}) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation(["wallet", "common"]);
  const restoring = useWalletMutation({ mutationFn: wallet.accounts.setHidden, gcTime: 0 });

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="h-auto rounded-sm p-0 text-inherit hover:bg-transparent hover:text-inherit hover:underline aria-busy:opacity-70"
      disabled={restoring.isPending}
      aria-busy={restoring.isPending}
      onClick={() => {
        toast.success(message, { id: toastId, duration: Infinity, dismissible: false });
        restoring.mutate(
          { accountId, hidden: false },
          {
            onSuccess: ({ account }) => {
              toast.success(t("accountRestored", { accountName: getAccountName(account, t) }));
            },
            onSettled: () => toast.dismiss(toastId),
          },
        );
      }}
    >
      {restoring.isPending && <Spinner aria-label={t("common:undo")} />}
      {t("common:undo")}
    </Button>
  );
}
