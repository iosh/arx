import type { AccountId } from "@arx/core/accounts";
import type { Network } from "@arx/core/networks";
import { TriangleAlert } from "lucide-react";
import { Value } from "ox";
import { useTranslation } from "react-i18next";
import { assetBalanceKey, useAssetBalances } from "@/ui/wallet/assets/useAssetBalances";

export function NativeAssetRow({ network, accountId }: { network: Network; accountId: AccountId }) {
  const { t, i18n } = useTranslation("wallet");
  const { chainRef } = network;
  const key = assetBalanceKey({ accountId, chainRef });
  const record = useAssetBalances((state) => state.records[key]);
  const snapshot = record?.snapshot;
  const isError = record?.failed === true;
  const isLoading = !snapshot && !isError;
  const currency = network.nativeCurrency;
  const balance = snapshot?.balances[0];
  const failure = balance
    ? t("networkBalanceCached", {
        network: network.name,
        time: new Date(snapshot.updatedAt).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }),
      })
    : t("networkBalanceUnavailable", { network: network.name });

  return (
    <li className="grid min-h-14 grid-cols-[2rem_minmax(5rem,1fr)_minmax(0,max-content)] items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0">
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-full bg-secondary text-[13px] font-semibold text-muted-foreground"
      >
        {Array.from(currency.name)[0]?.toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm leading-5 font-semibold" title={currency.name}>
          {currency.name}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
          <span className="min-w-0 truncate" title={network.name}>
            {network.name}
          </span>
          {network.isTestnet && <span className="shrink-0 rounded bg-secondary px-1 text-[10px]">{t("testnet")}</span>}
        </span>
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right text-xs leading-4 text-muted-foreground">
        {isError && (
          <span role="img" aria-label={failure} title={failure} className="shrink-0 text-warning">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
          </span>
        )}
        {balance ? (
          <span dir="ltr" className="min-w-0 wrap-anywhere">
            {Value.format(Value.from(balance.balance), currency.decimals)} {currency.symbol}
          </span>
        ) : isLoading ? (
          <>
            <span aria-hidden="true" className="h-3 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="sr-only">{t("updatingBalances")}</span>
          </>
        ) : (
          <span>—</span>
        )}
      </span>
    </li>
  );
}
