import type { Account } from "@arx/core/accounts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountIdenticon } from "@/ui/components/accounts/AccountIdenticon";
import { ConfirmAccountMoveSheet } from "@/ui/components/accounts/ConfirmAccountMoveSheet";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { groupAccountsBySource } from "@/ui/wallet/accounts/groupAccountsBySource";
import { useSelectedAccount } from "@/ui/wallet/accounts/useSelectedAccount";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useVisibleAccounts";
import { useHdWallets } from "@/ui/wallet/keyring/useMnemonicSources";
import { useAccountCreation } from "./useAccountCreation";

export function AccountsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("wallet");
  const { data: accounts = [], isPending } = useVisibleAccounts();
  const { data: wallets = [], isPending: walletsPending } = useHdWallets();
  const { data: selectedAccount } = useSelectedAccount();
  const creation = useAccountCreation();
  const { candidate } = creation;

  const sections = groupAccountsBySource(accounts, wallets);

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("accounts")} · ARX`}</title>
      <PageHeader
        title={t("accounts")}
        backTo="/wallet"
        backLabel={t("backToWallet")}
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7.5 rounded-md text-muted-foreground"
            aria-label={t("addAccount")}
            onClick={() => {
              if (
                wallets.some(({ hdKeyrings }) =>
                  hdKeyrings.some((keyring) => keyring.namespace === selectedAccount?.namespace),
                )
              ) {
                void navigate({ to: "/wallet/accounts/add" });
              }
            }}
          >
            <Plus aria-hidden="true" className="size-4.5" />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {isPending && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            <Spinner aria-label={t("loadingAccounts")} />
          </div>
        )}
        {walletsPending && !isPending && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            <Spinner aria-label={t("loadingAccounts")} />
          </div>
        )}
        {sections.map((section) => {
          if (section.type === "private-key") {
            return (
              <section key={section.id} className="shrink-0 rounded-2xl bg-card py-1 text-card-foreground">
                <AccountRows accounts={[section.account]} selectedAccountId={selectedAccount?.accountId} />
              </section>
            );
          }
          const { id, source, accounts, hdKeyrings } = section;
          const hdKeyring = hdKeyrings.find((keyring) => keyring.namespace === selectedAccount?.namespace);
          return (
            <section
              key={id}
              className="shrink-0 rounded-2xl bg-card py-1 text-card-foreground"
              aria-label={source.name}
            >
              <h2>
                <Link
                  to="/wallet/wallets/$keySourceId"
                  params={{ keySourceId: source.keySourceId }}
                  className="flex h-11 items-center gap-2 rounded-xl px-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <KeyRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-semibold">{source.name}</span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{`· ${t("recoveryPhrase")}`}</span>
                  <ChevronRight aria-hidden="true" className="ml-auto size-3.75 shrink-0 text-placeholder" />
                </Link>
              </h2>
              <AccountRows accounts={accounts} selectedAccountId={selectedAccount?.accountId} />
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={creation.isPending || !hdKeyring}
                aria-label={`${t("createAccount")} · ${source.name}`}
                className="w-full justify-start gap-3 px-4"
                onClick={(event) => {
                  if (hdKeyring)
                    creation.create(
                      { hdKeyringId: hdKeyring.hdKeyringId, walletName: source.name },
                      event.currentTarget,
                    );
                }}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  {hdKeyring && creation.creatingKeyringId === hdKeyring.hdKeyringId ? (
                    <Spinner aria-label={t("creatingAccount")} />
                  ) : (
                    <Plus aria-hidden="true" className="size-4" />
                  )}
                </span>
                {t("createAccount")}
              </Button>
            </section>
          );
        })}
      </div>
      {candidate && (
        <ConfirmAccountMoveSheet
          account={candidate.account}
          walletName={candidate.target.walletName}
          isPending={creation.isPending}
          onCancel={creation.cancel}
          onConfirm={() => creation.move(candidate)}
          returnFocusRef={creation.returnFocusRef}
        />
      )}
    </main>
  );
}

function AccountRows({
  accounts,
  selectedAccountId,
}: {
  accounts: readonly Account[];
  selectedAccountId: Account["accountId"] | undefined;
}) {
  const { t } = useTranslation("wallet");

  return (
    <ul>
      {accounts.map((account) => (
        <li key={account.accountId}>
          <Link
            to="/wallet/accounts/$accountId"
            params={{ accountId: account.accountId }}
            className="flex h-14 items-center gap-3 rounded-xl px-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <AccountIdenticon accountId={account.accountId} size={32} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{getAccountName(account, t)}</span>
              {account.origin.type === "private-key" && (
                <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-xs font-medium text-muted-foreground">
                  {t("privateKey")}
                </span>
              )}
              {account.accountId === selectedAccountId && (
                <span className="shrink-0 rounded bg-brand-subtle px-1.5 py-px text-xs font-semibold text-brand">
                  {t("currentAccount")}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
