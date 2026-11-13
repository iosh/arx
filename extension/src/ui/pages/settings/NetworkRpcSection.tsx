import {
  type Network,
  NetworkConfigurationChangedError,
  type NetworkRpcConfiguration,
  NetworkRpcEndpointRequiredError,
  type NetworkUrlUpdate,
} from "@arx/core/networks";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/ui/components/ui/button";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { updateRpcCache } from "@/ui/wallet/networks/useNetworkRpcConfiguration";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { NetworkUrlDeleteDialog } from "./NetworkUrlDeleteDialog";
import { NetworkUrlList, NetworkUrlRow } from "./NetworkUrlList";
import { NetworkUrlSheet, type NetworkUrlTarget } from "./NetworkUrlSheet";

export function NetworkRpcSection({
  network,
  configuration,
}: {
  network: Network;
  configuration: NetworkRpcConfiguration;
}) {
  const { t } = useTranslation("wallet");
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();
  const reportError = useWalletError();
  const trigger = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<{ target: NetworkUrlTarget | null } | null>(null);
  const [deleting, setDeleting] = useState<NetworkUrlTarget | null>(null);
  const toasterId = useId();
  const saveUrl = async (update: NetworkUrlUpdate) => {
    const result = await wallet.networks.updateRpcEndpoints({ chainRef: network.chainRef, update });
    await updateRpcCache(queryClient, network.chainRef, result);
    trigger.current = null;
  };
  const removal = useWalletMutation({
    mutationFn: (target: NetworkUrlTarget) => saveUrl({ type: "remove", index: target.index, expectedUrl: target.url }),
    gcTime: 0,
  });
  const restoring = useWalletMutation({
    mutationFn: async () => {
      const result = await wallet.networks.clearRpcOverride(network.chainRef);
      await updateRpcCache(queryClient, network.chainRef, result);
    },
    gcTime: 0,
  });
  const occurrences = new Map<string, number>();

  function restoreFocus(event: Event) {
    event.preventDefault();
    (trigger.current?.isConnected ? trigger.current : addButton.current)?.focus();
  }

  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-medium">{t("rpcNodes")}</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t(configuration.source === "override" ? "customRpc" : "defaultRpc")}</span>
          {configuration.source === "override" && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-8 px-0 text-xs"
              disabled={restoring.isPending}
              aria-busy={restoring.isPending}
              onClick={() => restoring.mutate(undefined, { onSuccess: () => addButton.current?.focus() })}
            >
              {t("restoreDefaultRpc")}
            </Button>
          )}
        </div>
      </div>
      <NetworkUrlList>
        {configuration.endpoints.map((url, index) => {
          const occurrence = occurrences.get(url) ?? 0;
          occurrences.set(url, occurrence + 1);
          // Equal RPC URLs have no distinct domain ID; retain other URLs' nodes when a preceding row is removed.
          return (
            <NetworkUrlRow key={JSON.stringify([url, occurrence])} url={url}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 rounded-xl bg-secondary text-muted-foreground"
                aria-label={t("editRpcNode", { number: index + 1 })}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  toast.dismiss();
                  setEditing({ target: { index, url } });
                }}
              >
                <Pencil aria-hidden="true" className="size-4" />
              </Button>
              {configuration.endpoints.length > 1 && (
                <>
                  <span aria-hidden="true" className="h-4 w-px bg-border" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 rounded-xl bg-secondary text-destructive-foreground"
                    disabled={removal.isPending}
                    aria-label={t("removeRpcNode", { number: index + 1 })}
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      toast.dismiss();
                      const target = { index, url };
                      setDeleting(target);
                    }}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </>
              )}
            </NetworkUrlRow>
          );
        })}
      </NetworkUrlList>
      <Button
        ref={addButton}
        type="button"
        variant="outline"
        className="h-10 w-full"
        onClick={(event) => {
          trigger.current = event.currentTarget;
          toast.dismiss();
          setEditing({ target: null });
        }}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("addRpcNode")}
      </Button>
      {editing && (
        <NetworkUrlSheet
          title={t("rpcNodes")}
          label={t("networkRpcUrl")}
          networkName={network.name}
          requiredMessage={t("rpcUrlRequired")}
          target={editing.target}
          onSave={saveUrl}
          onCloseAutoFocus={restoreFocus}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <NetworkUrlDeleteDialog
          title={t("deleteRpcNode")}
          url={deleting.url}
          pending={removal.isPending}
          toasterId={toasterId}
          onClose={() => setDeleting(null)}
          onCloseAutoFocus={restoreFocus}
          onConfirm={() =>
            removal.mutate(deleting, {
              onSuccess: () => {
                setDeleting(null);
              },
              onError: (error) => {
                const message = isWalletApiError(error, NetworkConfigurationChangedError)
                  ? t("networkConfigurationChanged")
                  : isWalletApiError(error, NetworkRpcEndpointRequiredError)
                    ? t("rpcNodeRequired")
                    : undefined;
                if (message) toast.error(message, { toasterId, duration: Infinity, closeButton: true });
                else reportError(error, toasterId);
              },
            })
          }
        />
      )}
    </section>
  );
}
