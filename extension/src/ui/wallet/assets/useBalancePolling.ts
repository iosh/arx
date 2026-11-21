import type { AccountId } from "@arx/core/accounts";
import type { ChainRef, Network } from "@arx/core/networks";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWallet } from "../connection/WalletContext";
import { useNetworks } from "../networks/useNetworks";
import { assetBalanceKey, useAssetBalances } from "./useAssetBalances";

function getTargets(accountId: AccountId | undefined, networks: readonly Network[], chainRef: ChainRef | undefined) {
  if (!accountId) return [];
  return networks
    .filter((network) => chainRef === undefined || network.chainRef === chainRef)
    .map((network) => ({ accountId, chainRef: network.chainRef }));
}

export function useBalancePolling(accountId: AccountId | undefined, chainRef: ChainRef | undefined) {
  const { client: wallet } = useWallet();
  const { data: networks = [] } = useNetworks();
  const refresh = useAssetBalances((state) => state.refresh);
  const staleTargets = useAssetBalances(
    useShallow((state) =>
      getTargets(accountId, networks, chainRef).flatMap((target) => {
        const record = state.records[assetBalanceKey(target)];
        return record?.stale ? [record.target] : [];
      }),
    ),
  );

  useEffect(() => {
    const targets = getTargets(accountId, networks, chainRef);
    if (targets.length === 0) return;
    const readVisibleBalances = () => {
      if (document.visibilityState === "visible") {
        void refresh(wallet, targets);
      }
    };
    readVisibleBalances();
    const interval = setInterval(readVisibleBalances, 60_000);
    document.addEventListener("visibilitychange", readVisibleBalances);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", readVisibleBalances);
    };
  }, [accountId, chainRef, networks, wallet, refresh]);

  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    if (staleTargets.length > 0) void refresh(wallet, staleTargets);
  }, [staleTargets, wallet, refresh]);
}
