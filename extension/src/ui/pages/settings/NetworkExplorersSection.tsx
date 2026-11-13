import { type Network, NetworkConfigurationChangedError, type NetworkUrlUpdate } from "@arx/core/networks";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/ui/components/ui/button";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { updateNetworkCache } from "@/ui/wallet/networks/useNetworks";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { NetworkUrlDeleteDialog } from "./NetworkUrlDeleteDialog";
import { NetworkUrlList, NetworkUrlRow } from "./NetworkUrlList";
import { NetworkUrlSheet, type NetworkUrlTarget } from "./NetworkUrlSheet";

export function NetworkExplorersSection({ network }: { network: Network }) {
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
    const result = await wallet.networks.updateBlockExplorers({ chainRef: network.chainRef, update });
    await updateNetworkCache(queryClient, result);
    trigger.current = null;
  };
  const removal = useWalletMutation({
    mutationFn: (target: NetworkUrlTarget) => saveUrl({ type: "remove", index: target.index, expectedUrl: target.url }),
    gcTime: 0,
  });
  const editable = network.source === "custom";
  const items = network.blockExplorers ?? [];

  function restoreFocus(event: Event) {
    event.preventDefault();
    (trigger.current?.isConnected ? trigger.current : addButton.current)?.focus();
  }

  return (
    <section className="flex shrink-0 flex-col gap-2">
      <h2 className="flex min-h-8 items-center px-1 text-sm font-medium">{t("blockExplorer")}</h2>
      {items.length ? (
        <NetworkUrlList>
          {items.map((item, index) => (
            <NetworkUrlRow key={item.url} url={item.url} name={item.name} link>
              {editable && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 rounded-xl bg-secondary text-muted-foreground"
                    aria-label={t("editBlockExplorer", { number: index + 1 })}
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      toast.dismiss();
                      setEditing({ target: { index, url: item.url } });
                    }}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  <span aria-hidden="true" className="h-4 w-px bg-border" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 rounded-xl bg-secondary text-destructive-foreground"
                    disabled={removal.isPending}
                    aria-label={t("removeBlockExplorer", { number: index + 1 })}
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      toast.dismiss();
                      const target = { index, url: item.url };
                      setDeleting(target);
                    }}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </>
              )}
            </NetworkUrlRow>
          ))}
        </NetworkUrlList>
      ) : (
        <p className="rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground">{t("noBlockExplorer")}</p>
      )}
      {editable && (
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
          {t("addBlockExplorer")}
        </Button>
      )}
      {editing && (
        <NetworkUrlSheet
          title={t("blockExplorer")}
          label={t("networkExplorerUrl")}
          networkName={network.name}
          requiredMessage={t("rpcUrlInvalid")}
          target={editing.target}
          onSave={saveUrl}
          onCloseAutoFocus={restoreFocus}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <NetworkUrlDeleteDialog
          title={t("deleteBlockExplorer")}
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
                if (isWalletApiError(error, NetworkConfigurationChangedError))
                  toast.error(t("networkConfigurationChanged"), { toasterId, duration: Infinity, closeButton: true });
                else reportError(error, toasterId);
              },
            })
          }
        />
      )}
    </section>
  );
}
