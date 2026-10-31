import { type AccountId, findAccountHideReplacement, LastVisibleAccountHiddenError } from "@arx/core/accounts";
import { isWalletApiError } from "@arx/wallet-api/client";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AccountIdenticon } from "@/ui/components/accounts/AccountIdenticon";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useMnemonicSource } from "@/ui/wallet/keyring/useMnemonicSources";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { AccountAddressCard } from "./AccountAddressCard";
import { showAccountHiddenToast } from "./AccountHiddenToast";
import { RemoveKeySourceSheet } from "./RemoveKeySourceSheet";
import { RenameSheet } from "./RenameSheet";
import { useKeySourceRemoval } from "./useKeySourceRemoval";

export function AccountDetailsPage({ accountId }: { accountId: AccountId }) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const navigate = useNavigate();
  const reportError = useWalletError();
  const hiding = useWalletMutation({ mutationFn: wallet.accounts.setHidden, gcTime: 0 });
  const removal = useKeySourceRemoval();
  const { data: accounts = [], isPending } = useVisibleAccounts();
  const account = accounts.find((candidate) => candidate.accountId === accountId);
  const { data: source, isPending: sourcePending } = useMnemonicSource(account);
  const name = account ? getAccountName(account, t) : t("accountDetails");
  const canHide = account !== undefined && findAccountHideReplacement(account, accounts) !== null;
  const privateKeySourceId = account?.origin.type === "private-key" ? account.origin.keySourceId : undefined;

  function hideAccount() {
    toast.dismiss();
    hiding.mutate(
      { accountId, hidden: true },
      {
        onSuccess: (result) => {
          showAccountHiddenToast(result, t);
          void navigate({ to: "/wallet/accounts", replace: true });
        },
        onError: (error) => {
          if (isWalletApiError(error, LastVisibleAccountHiddenError)) {
            toast.error(t("lastVisibleAccount"), { duration: Infinity, closeButton: true });
            return;
          }
          reportError(error);
        },
      },
    );
  }

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${name} · ARX`}</title>
      <PageHeader
        title={name}
        backTo="/wallet/accounts"
        backLabel={t("backToAccounts")}
        backDisabled={hiding.isPending || removal.isPending}
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
            <AccountAddressCard account={account} />
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
              ) : source ? (
                <Link
                  to="/wallet/wallets/$keySourceId"
                  params={{ keySourceId: source.keySourceId }}
                  className="flex h-12 items-center gap-2 px-4 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="shrink-0 font-medium">{t("parentWallet")}</span>
                  <span className="ml-auto truncate text-muted-foreground">{source.name}</span>
                  <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-placeholder" />
                </Link>
              ) : (
                <div className="flex h-12 items-center px-4 text-sm text-muted-foreground">
                  {sourcePending ? <Spinner aria-label={t("loadingWallet")} /> : t("walletUnavailable")}
                </div>
              )}
            </div>
            {privateKeySourceId && (
              <RemoveKeySourceSheet
                label={t("removeAccount")}
                title={t("removeAccountTitle", { accountName: name })}
                description={t("removeAccountDescription")}
                backupLabel={t("confirmPrivateKeyBackup")}
                canRemove={accounts.some((candidate) => candidate.accountId !== accountId)}
                isPending={removal.isPending}
                onConfirm={() => removal.removeKeySource(privateKeySourceId, name)}
              />
            )}
            {account.origin.type === "hd" && (
              <>
                <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="w-full justify-start px-4 aria-busy:opacity-70"
                    disabled={!canHide || hiding.isPending}
                    aria-busy={hiding.isPending}
                    aria-describedby={!canHide ? "hide-account-help" : undefined}
                    onClick={hideAccount}
                  >
                    {hiding.isPending && <Spinner aria-label={t("hideAccount")} />}
                    {t("hideAccount")}
                  </Button>
                </div>
                {!canHide && (
                  <p id="hide-account-help" className="px-1.5 text-xs leading-relaxed text-muted-foreground">
                    {t("lastVisibleAccount")}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
