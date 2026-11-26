import { type AccountGroupId, findAccountHideReplacement, LastVisibleAccountHiddenError } from "@arx/core/accounts";
import { isWalletApiError } from "@arx/wallet-api/client";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AccountIdenticon } from "@/ui/components/accounts/AccountIdenticon";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { PageHeader } from "@/ui/components/PageHeader";
import { RenameSheet } from "@/ui/components/RenameSheet";
import { Button } from "@/ui/components/ui/button";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useMnemonicSource } from "@/ui/wallet/keyring/useMnemonicSources";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { AccountAddressCard } from "./AccountAddressCard";
import { showAccountHiddenToast } from "./AccountHiddenToast";
import { RemoveKeySourceSheet } from "./RemoveKeySourceSheet";
import { useKeySourceRemoval } from "./useKeySourceRemoval";

export function AccountDetailsPage({ accountGroupId }: { accountGroupId: AccountGroupId }) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const navigate = useNavigate();
  const reportError = useWalletError();
  const hiding = useWalletMutation({ mutationFn: wallet.accounts.setHidden, gcTime: 0 });
  const removal = useKeySourceRemoval();
  const { data: accountGroups } = useVisibleAccounts();
  const group = accountGroups?.find((candidate) => candidate.accountGroupId === accountGroupId);
  const { data: source } = useMnemonicSource(group);
  const name = group ? getAccountName(group, t) : t("accountDetails");
  const unavailable = Boolean(accountGroups && !group);
  const canHide = Boolean(group && accountGroups && findAccountHideReplacement(group, accountGroups));
  const privateKeySourceId = group?.source.type === "private-key" ? group.source.keySourceId : undefined;
  const exportPrivateKeyLink = group?.accounts.map((account) => (
    <Link
      key={account.accountId}
      to="/wallet/accounts/$accountGroupId/export-private-key/$accountId"
      params={{ accountGroupId, accountId: account.accountId }}
      disabled={hiding.isPending || removal.isPending}
      className="flex h-12 items-center justify-between gap-2 px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-45"
    >
      {t("exportPrivateKey")}
      <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-placeholder" />
    </Link>
  ));

  function hideAccount() {
    toast.dismiss();
    hiding.mutate(
      { accountGroupId, hidden: true },
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
        icon={
          <span className="size-7 shrink-0">{group && <AccountIdenticon seed={group.accountGroupId} size={28} />}</span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {unavailable ? (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">{t("accountUnavailable")}</div>
        ) : (
          <AccountAddressCard accountGroup={group} receivable />
        )}
        {!unavailable && (
          <div className="min-h-26 shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
            <RenameSheet
              label={t("accountNameLabel")}
              name={group ? name : undefined}
              disabled={!group}
              onRename={(alias) => wallet.accounts.rename({ accountGroupId, alias })}
            />
            {group?.source.type === "private-key" ? (
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
              <div className="flex h-12 items-center gap-2 px-4 text-sm">
                <span className="shrink-0 font-medium">
                  {t(group?.source.type === "bip39" ? "parentWallet" : "accountSource")}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {group && source === null && t("walletUnavailable")}
                </span>
              </div>
            )}
          </div>
        )}
        {group && (
          <>
            {privateKeySourceId && (
              <RemoveKeySourceSheet
                label={t("removeAccount")}
                title={t("removeAccountTitle", { accountName: name })}
                description={t("removeAccountDescription")}
                backupLabel={t("confirmPrivateKeyBackup")}
                canRemove={accountGroups?.some((candidate) => candidate.accountGroupId !== accountGroupId)}
                isPending={removal.isPending}
                leadingAction={exportPrivateKeyLink}
                onConfirm={() => removal.removeKeySource(privateKeySourceId, name)}
              />
            )}
            {group.source.type === "bip39" && (
              <>
                <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
                  {exportPrivateKeyLink}
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="w-full justify-start px-4"
                    disabled={!canHide || hiding.isPending}
                    aria-busy={hiding.isPending}
                    aria-describedby={!canHide ? "hide-account-help" : undefined}
                    onClick={hideAccount}
                  >
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
