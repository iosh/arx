import type { Account } from "@arx/core/accounts";
import type { HdKeyring, KeySourceId } from "@arx/core/keyring";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/ui/components/PageHeader";
import { Spinner } from "@/ui/components/ui/spinner";
import { getWalletAccounts } from "@/ui/wallet/accounts/groupAccountsBySource";
import { useAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useMnemonicWallet } from "@/ui/wallet/keyring/useMnemonicSources";
import { RemoveKeySourceSheet } from "./RemoveKeySourceSheet";
import { RenameSheet } from "./RenameSheet";
import { useKeySourceRemoval } from "./useKeySourceRemoval";

function getWalletRemovalInfo(accounts: readonly Account[], hdKeyrings: readonly HdKeyring[]) {
  const walletAccounts = getWalletAccounts(accounts, hdKeyrings);
  const visibleCount = walletAccounts.filter((account) => !account.hidden).length;
  const remainingVisibleCount = accounts.filter((account) => !account.hidden).length - visibleCount;

  return {
    totalCount: walletAccounts.length,
    visibleCount,
    hiddenCount: walletAccounts.length - visibleCount,
    canRemove: remainingVisibleCount > 0,
  };
}

export function WalletDetailsPage({ keySourceId }: { keySourceId: KeySourceId }) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const { data: accounts } = useAccounts();
  const { data: mnemonicWallet, isPending: walletPending } = useMnemonicWallet(keySourceId);
  const removal = useKeySourceRemoval();
  const name = mnemonicWallet?.source.name ?? t("walletDetails");
  const removalInfo =
    mnemonicWallet && accounts ? getWalletRemovalInfo(accounts, mnemonicWallet.hdKeyrings) : undefined;
  const subtitle = removalInfo ? t("walletAccountCount", { count: removalInfo.visibleCount }) : t("recoveryPhrase");
  const removalDescription =
    removalInfo &&
    t(removalInfo.hiddenCount > 0 ? "removeWalletWithHiddenDescription" : "removeWalletDescription", {
      count: removalInfo.totalCount,
      hiddenCount: removalInfo.hiddenCount,
    });

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${name} · ARX`}</title>
      <PageHeader
        title={name}
        backTo="/wallet/accounts"
        backLabel={t("backToAccounts")}
        backDisabled={removal.isPending}
        subtitle={mnemonicWallet ? subtitle : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {mnemonicWallet ? (
          <>
            <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
              <RenameSheet
                label={t("walletNameLabel")}
                name={mnemonicWallet.source.name}
                onRename={(name) => wallet.keySources.renameMnemonic({ keySourceId, name })}
              />
            </div>
            <RemoveKeySourceSheet
              label={t("removeWallet")}
              title={t("removeWalletTitle", { walletName: name })}
              description={removalDescription}
              backupLabel={t("confirmPhraseBackup")}
              canRemove={removalInfo?.canRemove}
              isPending={removal.isPending}
              onConfirm={() => removal.removeKeySource(keySourceId, name)}
            />
          </>
        ) : (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            {walletPending ? <Spinner aria-label={t("loadingWallet")} /> : t("walletUnavailable")}
          </div>
        )}
      </div>
    </main>
  );
}
