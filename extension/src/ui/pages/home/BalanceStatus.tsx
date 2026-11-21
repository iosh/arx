import type { AccountId } from "@arx/core/accounts";
import type { Network } from "@arx/core/networks";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/ui/button";
import { assetBalanceKey, useAssetBalances } from "@/ui/wallet/assets/useAssetBalances";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

export function BalanceStatus({
  accountId,
  networks,
  networkName,
}: {
  accountId: AccountId | undefined;
  networks: readonly Network[];
  networkName?: string;
}) {
  const { t, i18n } = useTranslation("wallet");
  const { client: wallet } = useWallet();
  const records = useAssetBalances((state) => state.records);
  const refresh = useAssetBalances((state) => state.refresh);
  const visible = accountId ? networks.map(({ chainRef }) => records[assetBalanceKey({ accountId, chainRef })]) : [];
  const isUpdating = visible.some((record) => record?.pending !== undefined);
  const failedCount = visible.filter((record) => record?.failed).length;
  const readTimes = visible.flatMap((record) => (record?.snapshot ? [record.snapshot.updatedAt] : []));
  const parts: string[] = [];

  if (networkName) parts.push(t("filteredNetwork", { network: networkName }));
  if (isUpdating) {
    parts.push(t("updatingBalances"));
  } else {
    if (failedCount > 0) parts.push(t("balanceUpdateFailed", { count: failedCount }));
    if (readTimes.length > 0) {
      const time = new Date(Math.min(...readTimes)).toLocaleString(i18n.language, {
        dateStyle: "short",
        timeStyle: "short",
      });
      parts.push(t("balancesUpdatedAt", { time }));
    }
  }

  const status = parts.join(" · ");
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      <p
        role="status"
        className={`min-w-0 truncate text-xs ${failedCount > 0 && !isUpdating ? "text-warning-foreground" : "text-muted-foreground"}`}
        title={status}
      >
        {status}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 shrink-0 text-foreground"
        aria-label={t("refreshBalances")}
        aria-busy={isUpdating}
        disabled={!accountId || networks.length === 0}
        onClick={() => {
          if (accountId)
            void refresh(
              wallet,
              networks.map(({ chainRef }) => ({ accountId, chainRef })),
            );
        }}
      >
        <RefreshCw
          aria-hidden="true"
          className={`size-4 ${isUpdating ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
      </Button>
    </div>
  );
}
