import type { AccountGroupId } from "@arx/core/accounts";
import type { SetAccountGroupHiddenResult } from "@arx/core/wallet";
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
  { account: group, replacementAccount: replacementGroup }: SetAccountGroupHiddenResult,
  t: TFunction<"wallet">,
) {
  const accountName = getAccountName(group, t);
  const message = replacementGroup
    ? t("accountHiddenAndSelected", { accountName, replacementName: getAccountName(replacementGroup, t) })
    : t("accountHidden", { accountName });
  const toastId = `hidden-account:${group.accountGroupId}`;
  toast.success(message, {
    id: toastId,
    icon: <EyeOff aria-hidden="true" className="size-3.75" />,
    action: <UndoAccountHideButton accountGroupId={group.accountGroupId} toastId={toastId} message={message} />,
  });
}

function UndoAccountHideButton({
  accountGroupId,
  toastId,
  message,
}: {
  accountGroupId: AccountGroupId;
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
          { accountGroupId, hidden: false },
          {
            onSuccess: ({ account: group }) => {
              toast.success(t("accountRestored", { accountName: getAccountName(group, t) }));
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
