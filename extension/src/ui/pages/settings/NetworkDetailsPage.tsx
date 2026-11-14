import { type ChainRef, type Network, NetworkHasPendingTransactionsError, parseChainRef } from "@arx/core/networks";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/ui/components/PageHeader";
import { RenameSheet } from "@/ui/components/RenameSheet";
import { Spinner } from "@/ui/components/ui/spinner";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworkRpcConfiguration } from "@/ui/wallet/networks/useNetworkRpcConfiguration";
import { removeNetworkCache, updateNetworkCache, useNetwork } from "@/ui/wallet/networks/useNetworks";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { NetworkCurrencySheet } from "./NetworkCurrencySheet";
import { NetworkDeleteDialog } from "./NetworkDeleteDialog";
import { NetworkExplorersSection } from "./NetworkExplorersSection";
import { NetworkRpcSection } from "./NetworkRpcSection";

export function NetworkDetailsPage({ chainRef }: { chainRef: ChainRef }) {
  const { t } = useTranslation("wallet");
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reportError = useWalletError();
  const [deletionOpen, setDeletionOpen] = useState(false);
  const { data: network, isPending } = useNetwork(chainRef);
  const { data: rpc, isPending: rpcPending } = useNetworkRpcConfiguration(chainRef, network != null);
  const deletion = useWalletMutation({
    mutationFn: async (chainRef: ChainRef) => {
      await wallet.networks.removeCustom(chainRef);
      await removeNetworkCache(queryClient, chainRef);
    },
    gcTime: 0,
  });

  useEffect(() => {
    if (network === null) setDeletionOpen(false);
  }, [network]);

  function deleteNetwork(network: Network) {
    deletion.mutate(network.chainRef, {
      onSuccess: () => {
        toast.success(t("networkDeleted", { name: network.name }));
        void navigate({ to: "/wallet/settings/networks", replace: true });
      },
      onError: (error) => {
        setDeletionOpen(false);
        if (isWalletApiError(error, NetworkHasPendingTransactionsError)) {
          toast.error(t("networkHasPendingTransactions"), {
            duration: Infinity,
            closeButton: true,
          });
          return;
        }
        reportError(error);
      },
    });
  }

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${network?.name ?? t("networkDetails")} · ARX`}</title>
      <PageHeader
        title={network?.name ?? t("networkDetails")}
        backTo="/wallet/settings/networks"
        backLabel={t("backToNetworks")}
        subtitle={network?.isTestnet ? t("testnet") : undefined}
      />
      {!network ? (
        <div className="flex min-h-14 items-center px-7.5 text-sm text-muted-foreground">
          {network === null ? t("networkUnavailable") : isPending ? <Spinner aria-label={t("loadingNetwork")} /> : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-4">
          <div className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground">
            {network.source === "custom" ? (
              <CustomNetworkInformation network={network} />
            ) : (
              <NetworkChainId chainRef={chainRef} />
            )}
          </div>
          <NetworkExplorersSection network={network} />
          {rpc ? (
            <>
              <NetworkRpcSection network={network} configuration={rpc} />
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("rpcNodeOrder")}</p>
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("rpcPrivacyNotice")}</p>
            </>
          ) : rpcPending ? (
            <div className="flex min-h-14 items-center px-4">
              <Spinner aria-label={t("loadingRpcConfiguration")} />
            </div>
          ) : null}
          {network.source === "builtin" && (
            <p className="px-1.5 text-xs leading-relaxed text-muted-foreground">{t("builtinNetworkNote")}</p>
          )}
          {network.source === "custom" && (
            <NetworkDeleteDialog
              network={network}
              description={t("deleteEvmNetworkDescription")}
              open={deletionOpen}
              onOpenChange={setDeletionOpen}
              pending={deletion.isPending}
              onConfirm={() => deleteNetwork(network)}
            />
          )}
        </div>
      )}
    </main>
  );
}

function CustomNetworkInformation({ network }: { network: Network }) {
  const { t } = useTranslation("wallet");
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();
  const marking = useWalletMutation({
    mutationFn: async (isTestnet: boolean) =>
      updateNetworkCache(
        queryClient,
        await wallet.networks.updateCustom({ chainRef: network.chainRef, changes: { isTestnet } }),
      ),
    gcTime: 0,
  });

  return (
    <>
      <RenameSheet
        label={t("networkName")}
        name={network.name}
        onRename={async (name) =>
          updateNetworkCache(
            queryClient,
            await wallet.networks.updateCustom({ chainRef: network.chainRef, changes: { name } }),
          )
        }
      />
      <NetworkChainId chainRef={network.chainRef} />
      <NetworkCurrencySheet network={network} />
      <label className="flex min-h-11 items-center justify-between gap-2 px-4 py-1.5 text-sm">
        <span className="font-medium">{t("testNetwork")}</span>
        <span className="relative flex h-5 w-9 shrink-0">
          <input
            type="checkbox"
            role="switch"
            aria-checked={network.isTestnet ?? false}
            checked={network.isTestnet ?? false}
            disabled={marking.isPending}
            aria-busy={marking.isPending}
            onChange={(event) => marking.mutate(event.currentTarget.checked)}
            className="peer h-5 w-9 appearance-none rounded-full bg-border outline-none checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-45"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-card transition-transform peer-checked:translate-x-4 peer-disabled:opacity-45"
          />
        </span>
      </label>
    </>
  );
}

function NetworkChainId({ chainRef }: { chainRef: ChainRef }) {
  return (
    <div className="flex min-h-11 items-center gap-2 px-4 py-1.5 text-sm">
      <span className="shrink-0 font-medium">Chain ID</span>
      <span className="min-w-0 flex-1 text-right wrap-anywhere text-muted-foreground">
        {parseChainRef(chainRef).reference}
      </span>
    </div>
  );
}
