import type { Account } from "@arx/core/accounts";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountIdenticon } from "@/ui/components/AccountIdenticon";
import { PageHeader } from "@/ui/components/PageHeader";
import { Spinner } from "@/ui/components/ui/spinner";
import { getAccountName } from "@/ui/wallet/getAccountName";
import { useMnemonicWallets } from "@/ui/wallet/useMnemonicSources";
import { useVisibleAccounts } from "@/ui/wallet/useVisibleAccounts";

export const Route = createFileRoute("/wallet/accounts")({
  component: Accounts,
});

function Accounts() {
  const { t } = useTranslation("wallet");
  const { data: accounts, isPending, isLoadingError } = useVisibleAccounts("eip155");
  const mnemonicWalletsQuery = useMnemonicWallets(accounts);

  const walletSections = (mnemonicWalletsQuery.data ?? []).map(({ source, accounts }) => ({
    id: source.keySourceId,
    createdAt: source.createdAt,
    source,
    accounts,
  }));
  const privateKeySections = (accounts ?? [])
    .filter((account) => account.origin.type === "private-key")
    .map((account) => ({
      id: account.accountId,
      createdAt: account.createdAt,
      source: null,
      accounts: [account],
    }));
  const sections = [...walletSections, ...privateKeySections].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("accounts")} · ARX`}</title>
      <PageHeader title={t("accounts")} backTo="/wallet" backLabel={t("backToWallet")} />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {isPending && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            <Spinner aria-label={t("loadingAccounts")} />
          </div>
        )}
        {isLoadingError && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            {t("accountsUnavailable")}
          </div>
        )}
        {mnemonicWalletsQuery.isEnabled && mnemonicWalletsQuery.isPending && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            <Spinner aria-label={t("loadingAccounts")} />
          </div>
        )}
        {mnemonicWalletsQuery.isEnabled && mnemonicWalletsQuery.isLoadingError && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            {t("accountSourcesUnavailable")}
          </div>
        )}
        {sections.map(({ id, source, accounts }) => (
          <section
            key={id}
            className="shrink-0 rounded-2xl bg-card py-1 text-card-foreground"
            aria-label={source?.name}
          >
            {source && (
              <h2 className="flex h-11 items-center gap-2 px-4">
                <KeyRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-semibold">{source.name}</span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">{`· ${t("recoveryPhrase")}`}</span>
              </h2>
            )}
            <AccountRows accounts={accounts} />
          </section>
        ))}
      </div>
    </main>
  );
}

function AccountRows({ accounts }: { accounts: readonly Account[] }) {
  const { t } = useTranslation("wallet");

  return (
    <ul>
      {accounts.map((account) => (
        <li key={account.accountId} className="flex h-14 items-center gap-3 px-4">
          <AccountIdenticon accountId={account.accountId} size={32} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{getAccountName(account, t)}</span>
            {account.origin.type === "private-key" && (
              <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-xs font-medium text-muted-foreground">
                {t("privateKey")}
              </span>
            )}
            {account.selected && (
              <span className="shrink-0 rounded bg-brand-subtle px-1.5 py-px text-xs font-semibold text-brand">
                {t("currentAccount")}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
