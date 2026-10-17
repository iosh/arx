import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountIdenticon } from "@/ui/components/AccountIdenticon";
import { PageHeader } from "@/ui/components/PageHeader";
import { Spinner } from "@/ui/components/ui/spinner";
import { getAccountName } from "@/ui/wallet/getAccountName";
import { useMnemonicSource } from "@/ui/wallet/useMnemonicSources";
import { useVisibleAccounts } from "@/ui/wallet/useVisibleAccounts";
import { useWallet } from "@/ui/wallet/WalletContext";
import { AccountAddressCard } from "./-wallet/AccountAddressCard";
import { RenameSheet } from "./-wallet/RenameSheet";

export const Route = createFileRoute("/wallet/accounts/$accountId")({
  component: AccountDetails,
  remountDeps: ({ params }) => params.accountId,
});

function AccountDetails() {
  const { accountId } = Route.useParams();
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const { data: accounts, isPending } = useVisibleAccounts("eip155");
  const account = accounts?.find((candidate) => candidate.accountId === accountId);
  const sourceQuery = useMnemonicSource(account);
  const name = account ? getAccountName(account, t) : t("accountDetails");

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${name} · ARX`}</title>
      <PageHeader
        title={name}
        backTo="/wallet/accounts"
        backLabel={t("backToAccounts")}
        icon={account && <AccountIdenticon accountId={account.accountId} size={28} />}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {!account && (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            {isPending ? <Spinner aria-label={t("loadingAccount")} /> : t("accountUnavailable")}
          </div>
        )}
        {account && (
          <>
            <AccountAddressCard accountId={account.accountId} />
            <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
              <RenameSheet
                label={t("accountNameLabel")}
                name={name}
                onRename={(alias) => wallet.accounts.rename({ accountId, alias })}
              />
              {account.origin.type === "private-key" ? (
                <div className="flex h-12 items-center justify-between gap-2 px-4 text-sm">
                  <span className="font-medium">{t("accountSource")}</span>
                  <span className="text-muted-foreground">{t("privateKeyImport")}</span>
                </div>
              ) : sourceQuery.data ? (
                <Link
                  to="/wallet/wallets/$keySourceId"
                  params={{ keySourceId: sourceQuery.data.keySourceId }}
                  className="flex h-12 items-center gap-2 px-4 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="shrink-0 font-medium">{t("parentWallet")}</span>
                  <span className="ml-auto truncate text-muted-foreground">{sourceQuery.data.name}</span>
                  <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-placeholder" />
                </Link>
              ) : (
                <div className="flex h-12 items-center px-4 text-sm text-muted-foreground">
                  {sourceQuery.isPending ? <Spinner aria-label={t("loadingWallet")} /> : t("walletUnavailable")}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
