import { type ChainRef, parseChainRef } from "@arx/core/networks";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NetworkAvatar } from "@/ui/components/networks/NetworkAvatar";
import { PageHeader } from "@/ui/components/PageHeader";
import { Spinner } from "@/ui/components/ui/spinner";
import { useNetworkRpcConfiguration } from "@/ui/wallet/networks/useNetworkRpcConfiguration";
import { useNetwork } from "@/ui/wallet/networks/useNetworks";

export function NetworkDetailsPage({ chainRef }: { chainRef: ChainRef }) {
  const { t } = useTranslation("wallet");
  const { data: network, isPending } = useNetwork(chainRef);
  const { data: rpc, isPending: rpcPending } = useNetworkRpcConfiguration(chainRef, network != null);
  const name = network?.name ?? t("networkDetails");

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${name} · ARX`}</title>
      <PageHeader
        title={name}
        backTo="/wallet/settings/networks"
        backLabel={t("backToNetworks")}
        icon={network && <NetworkAvatar name={network.name} />}
        subtitle={network?.isTestnet ? t("testnet") : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {isPending && (
          <div className="flex min-h-14 items-center px-4">
            <Spinner aria-label={t("loadingNetwork")} />
          </div>
        )}
        {network === null && <p className="px-4 py-4 text-sm text-muted-foreground">{t("networkUnavailable")}</p>}
        {network && (
          <>
            <dl className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
              <div className="flex min-h-12 items-center gap-2 px-4 py-3 text-sm">
                <dt className="shrink-0 font-medium">Chain ID</dt>
                <dd className="min-w-0 flex-1 text-right wrap-anywhere text-muted-foreground">
                  {parseChainRef(network.chainRef).reference}
                </dd>
              </div>
              <div>
                <dt className="sr-only">{t("rpcNodes")}</dt>
                <dd>
                  <Link
                    to="/wallet/settings/networks/$chainRef/rpc"
                    params={{ chainRef }}
                    className="flex min-h-12 items-start gap-2 px-4 py-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="shrink-0 font-medium">{t("rpcNodes")}</span>
                    <div className="min-w-0 flex-1 text-right text-muted-foreground">
                      {rpc ? (
                        <>
                          <span>{rpc.source === "override" ? t("customRpc") : t("defaultRpc")}</span>
                          <ul className="mt-1 space-y-1 text-xs leading-relaxed">
                            {rpc.endpoints.map((endpoint, index) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: Duplicate endpoints are allowed; these rows contain only text.
                              <li key={`${index}-${endpoint}`} className="wrap-anywhere">
                                {endpoint}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : rpcPending ? (
                        <Spinner aria-label={t("loadingRpcConfiguration")} className="ml-auto" />
                      ) : null}
                    </div>
                    <ChevronRight aria-hidden="true" className="mt-0.5 size-3.75 shrink-0 text-placeholder" />
                  </Link>
                </dd>
              </div>
              <div className="flex min-h-12 items-start gap-2 px-4 py-3 text-sm">
                <dt className="shrink-0 font-medium">{t("blockExplorer")}</dt>
                <dd className="min-w-0 flex-1 text-right text-muted-foreground">
                  {network.blockExplorers?.length ? (
                    <ul className="space-y-1">
                      {network.blockExplorers.map((explorer) => (
                        <li key={explorer.url}>
                          <a
                            href={explorer.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-sm wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {explorer.name ?? new URL(explorer.url).host}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    t("noBlockExplorer")
                  )}
                </dd>
              </div>
            </dl>
            {network.source === "builtin" && (
              <p className="px-1.5 text-xs leading-relaxed text-muted-foreground">{t("builtinNetworkNote")}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
