import type { KeySourceId } from "@arx/core/keyring";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/ui/components/PageHeader";
import { Spinner } from "@/ui/components/ui/spinner";
import { getWalletAccounts } from "@/ui/wallet/accounts/groupAccountsBySource";
import { useVisibleAccounts } from "@/ui/wallet/accounts/useAccounts";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useMnemonicWallet } from "@/ui/wallet/keyring/useMnemonicSources";
import { RenameSheet } from "./RenameSheet";

export function WalletDetailsPage({ keySourceId }: { keySourceId: KeySourceId }) {
  const { client: wallet } = useWallet();
  const { t } = useTranslation("wallet");
  const { data: visibleAccounts } = useVisibleAccounts();
  const { data: mnemonicWallet, isPending: walletPending } = useMnemonicWallet(keySourceId);
  const name = mnemonicWallet?.source.name ?? t("walletDetails");
  const accounts =
    mnemonicWallet && visibleAccounts ? getWalletAccounts(visibleAccounts, mnemonicWallet.hdKeyrings) : undefined;
  const subtitle = accounts ? t("walletAccountCount", { count: accounts.length }) : t("recoveryPhrase");

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${name} · ARX`}</title>
      <PageHeader
        title={name}
        backTo="/wallet/accounts"
        backLabel={t("backToAccounts")}
        subtitle={mnemonicWallet ? subtitle : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {mnemonicWallet ? (
          <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
            <RenameSheet
              label={t("walletNameLabel")}
              name={mnemonicWallet.source.name}
              onRename={(name) => wallet.keySources.renameMnemonic({ keySourceId, name })}
            />
          </div>
        ) : (
          <div className="flex min-h-14 items-center px-4 text-sm text-muted-foreground">
            {walletPending ? <Spinner aria-label={t("loadingWallet")} /> : t("walletUnavailable")}
          </div>
        )}
      </div>
    </main>
  );
}
