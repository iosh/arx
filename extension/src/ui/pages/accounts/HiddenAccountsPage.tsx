import type { AccountId } from "@arx/core/accounts";
import type { KeySourceId } from "@arx/core/keyring";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AccountIdenticon } from "@/ui/components/accounts/AccountIdenticon";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { getWalletAccounts } from "@/ui/wallet/accounts/groupAccountsBySource";
import { useAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useMnemonicWallet } from "@/ui/wallet/keyring/useMnemonicSources";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";

export function HiddenAccountsPage({ keySourceId }: { keySourceId: KeySourceId }) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const { data: accounts } = useAccounts();
  const { data: mnemonicWallet, isPending: walletPending } = useMnemonicWallet(keySourceId);
  const restoring = useWalletMutation({ mutationFn: wallet.accounts.setHidden, gcTime: 0 });
  const hiddenAccounts =
    mnemonicWallet && accounts
      ? getWalletAccounts(accounts, mnemonicWallet.hdKeyrings).filter((account) => account.hidden)
      : undefined;

  function restoreAccount(accountId: AccountId) {
    toast.dismiss();
    restoring.mutate(
      { accountId, hidden: false },
      {
        onSuccess: ({ account }) => toast.success(t("accountRestored", { accountName: getAccountName(account, t) })),
      },
    );
  }

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("hiddenAccounts")} · ARX`}</title>
      <PageHeader
        title={t("hiddenAccounts")}
        subtitle={mnemonicWallet?.source.name}
        backTo="/wallet/accounts"
        backLabel={t("backToAccounts")}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {!mnemonicWallet && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            {walletPending ? <Spinner aria-label={t("loadingWallet")} /> : t("walletUnavailable")}
          </div>
        )}
        {mnemonicWallet && !hiddenAccounts && (
          <div className="flex min-h-14 items-center px-4 text-muted-foreground">
            <Spinner aria-label={t("loadingAccounts")} />
          </div>
        )}
        {hiddenAccounts && hiddenAccounts.length > 0 && (
          <ul className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
            {hiddenAccounts.map((account) => {
              const pending = restoring.isPending && restoring.variables.accountId === account.accountId;
              return (
                <li key={account.accountId} className="flex h-14 items-center gap-3 px-4">
                  <AccountIdenticon accountId={account.accountId} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{getAccountName(account, t)}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    className="h-7 rounded-full px-3 aria-busy:opacity-70"
                    disabled={restoring.isPending}
                    aria-busy={pending}
                    onClick={() => restoreAccount(account.accountId)}
                  >
                    {pending && <Spinner aria-label={t("restoreAccount")} />}
                    {t("restoreAccount")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {hiddenAccounts?.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("noHiddenAccounts")}</p>
        )}
        {hiddenAccounts && (
          <p className="px-1.5 text-xs leading-relaxed text-muted-foreground">{t("restoreAccountHelp")}</p>
        )}
      </div>
    </main>
  );
}
