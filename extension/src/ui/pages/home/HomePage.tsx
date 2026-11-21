import { Link, useRouter } from "@tanstack/react-router";
import { ArrowDownLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import browser from "webextension-polyfill";
import { getAccountName } from "@/ui/components/accounts/getAccountName";
import { Button } from "@/ui/components/ui/button";
import { useSelectedAccount } from "@/ui/wallet/accounts/useAccounts";
import { useBalancePolling } from "@/ui/wallet/assets/useBalancePolling";
import { usePendingMnemonicSource } from "@/ui/wallet/keyring/useMnemonicSources";
import { useNetworks } from "@/ui/wallet/networks/useNetworks";
import { BalanceStatus } from "./BalanceStatus";
import { HomeHeader } from "./HomeHeader";
import { HomeNetworkFilter } from "./HomeNetworkFilter";
import { NativeAssetRow } from "./NativeAssetRow";
import { useHomeNetworkFilter } from "./useHomeNetworkFilter";

export function HomePage() {
  const router = useRouter();
  const { t } = useTranslation("wallet");
  const { data: account } = useSelectedAccount();
  const { data: networks = [] } = useNetworks();
  const { data: source } = usePendingMnemonicSource(account);
  const { chainRef, setChainRef } = useHomeNetworkFilter();

  const name = account ? getAccountName(account, t) : null;
  const accountId = account?.members[0].accountId;
  const selectedNetwork = networks.find((network) => network.chainRef === chainRef);
  const filteredNetworks = selectedNetwork ? [selectedNetwork] : networks;
  useBalancePolling(accountId, selectedNetwork?.chainRef);

  return (
    <main className="flex h-full flex-col gap-2.5 px-3.5 font-sans">
      <title>{name ? `${name} · ARX` : "ARX"}</title>
      <HomeHeader account={account} />
      <section className="shrink-0 overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_var(--shadow)]">
        <div className="px-4 pt-3 pb-4">
          <BalanceStatus accountId={accountId} networks={filteredNetworks} networkName={selectedNetwork?.name} />
          <div className="mt-3 grid w-full grid-cols-2 gap-2.5">
            {account ? (
              <Button asChild variant="secondary" className="h-10">
                <Link
                  to="/wallet/receive/$accountGroupId/$accountId"
                  params={{ accountGroupId: account.accountGroupId, accountId: account.members[0].accountId }}
                >
                  <ArrowDownLeft aria-hidden="true" />
                  {t("receive")}
                </Link>
              </Button>
            ) : (
              <Button type="button" variant="secondary" className="h-10" disabled>
                <ArrowDownLeft aria-hidden="true" />
                {t("receive")}
              </Button>
            )}
          </div>
        </div>
        {source && (
          <a
            href={`${browser.runtime.getURL("/onboarding.html")}#${
              router.buildLocation({
                to: "/onboarding/backup-mnemonic/$keySourceId",
                params: { keySourceId: source.keySourceId },
              }).href
            }`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-10 items-center gap-2 bg-warning-subtle px-4 py-2.5 text-xs font-semibold text-warning-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ShieldAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 wrap-anywhere">{t("backupNotice", { walletName: source.name })}</span>
            <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-warning" />
          </a>
        )}
      </section>
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 px-4">
        <h2 className="flex h-full items-center border-b-2 border-brand text-base font-semibold">{t("assets")}</h2>
        <HomeNetworkFilter networks={networks} selectedNetwork={selectedNetwork} onSelect={setChainRef} />
      </div>
      <section aria-label={t("assets")} className="min-h-0 flex-1 pb-3.5">
        <ul className="max-h-full overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-[0_1px_3px_var(--shadow)]">
          {accountId &&
            filteredNetworks.map((network) => (
              <NativeAssetRow key={`${accountId}:${network.chainRef}`} network={network} accountId={accountId} />
            ))}
        </ul>
      </section>
    </main>
  );
}
