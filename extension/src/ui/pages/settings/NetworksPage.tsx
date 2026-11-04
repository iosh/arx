import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NetworkAvatar } from "@/ui/components/networks/NetworkAvatar";
import { PageHeader } from "@/ui/components/PageHeader";
import { Spinner } from "@/ui/components/ui/spinner";
import { useNetworks } from "@/ui/wallet/networks/useNetworks";

export function NetworksPage() {
  const { t } = useTranslation("wallet");
  const { data: networks, isPending } = useNetworks();

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("networks")} · ARX`}</title>
      <PageHeader title={t("networks")} backTo="/wallet/settings" backLabel={t("backToSettings")} />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {isPending && (
          <div className="flex min-h-14 items-center px-4">
            <Spinner aria-label={t("loadingNetworks")} />
          </div>
        )}
        {networks && (
          <ul className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
            {networks.map((network) => (
              <li key={network.chainRef}>
                <Link
                  to="/wallet/settings/networks/$chainRef"
                  params={{ chainRef: network.chainRef }}
                  className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <NetworkAvatar name={network.name} />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 wrap-anywhere">{network.name}</span>
                    {network.source === "custom" && (
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                        {t("customNetwork")}
                      </span>
                    )}
                    {network.isTestnet && (
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                        {t("testnet")}
                      </span>
                    )}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-3.75 shrink-0 text-placeholder" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
