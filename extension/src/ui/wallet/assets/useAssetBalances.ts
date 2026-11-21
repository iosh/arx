import type { AccountId } from "@arx/core/accounts";
import type { AssetBalance } from "@arx/core/assets";
import type { ChainRef } from "@arx/core/networks";
import type { WalletClient } from "@arx/wallet-api/client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AssetBalanceTarget = Parameters<WalletClient["assets"]["getBalances"]>[0];
type BalanceSnapshot = { balances: readonly AssetBalance[]; updatedAt: number };
type BalanceRecord = {
  target: AssetBalanceTarget;
  snapshot?: BalanceSnapshot;
  pending?: Promise<void>;
  failed?: boolean;
  stale?: boolean;
};
type BalanceRecords = Record<string, BalanceRecord>;
type BalanceFilter = { accountIds: readonly AccountId[] } | { chainRefs: readonly ChainRef[] };
type AssetBalancesState = {
  records: BalanceRecords;
  refresh(wallet: WalletClient, targets: readonly AssetBalanceTarget[]): Promise<void>;
  invalidate(filter: BalanceFilter): void;
  remove(filter: BalanceFilter): void;
};

export const assetBalanceKey = ({ accountId, chainRef }: AssetBalanceTarget) => JSON.stringify([accountId, chainRef]);

function matches(target: AssetBalanceTarget, filter: BalanceFilter) {
  return "accountIds" in filter
    ? filter.accountIds.includes(target.accountId)
    : filter.chainRefs.includes(target.chainRef);
}

export const useAssetBalances = create<AssetBalancesState>()(
  persist(
    (set, get) => {
      function updateRecords(update: (records: BalanceRecords) => BalanceRecords) {
        const current = get().records;
        const records = update(current);
        if (records === current) return;
        try {
          set({ records });
        } catch (error) {
          if (!(error instanceof DOMException)) throw error;
          // persist writes after updating memory; a storage failure is separate from the RPC result.
          console.warn("[arx:ui] Could not persist asset balances.", error);
        }
      }

      function completeRequest(
        key: string,
        request: Promise<void>,
        result: { snapshot: BalanceSnapshot; failed: false } | { failed: true },
      ) {
        updateRecords((records) => {
          const record = records[key];
          // Deletion or invalidation detaches this request; only the current request may update the record.
          if (record?.pending !== request) return records;
          return { ...records, [key]: { ...record, ...result, pending: undefined } };
        });
      }

      return {
        records: {},
        async refresh(wallet, targets) {
          const started: BalanceRecords = {};
          const requests = targets.map((target) => {
            const key = assetBalanceKey(target);
            const record = started[key] ?? get().records[key];
            if (record?.pending) return record.pending;

            const request: Promise<void> = wallet.assets.getBalances(target).then(
              (balances) =>
                completeRequest(key, request, {
                  snapshot: { balances, updatedAt: Date.now() },
                  failed: false,
                }),
              () => completeRequest(key, request, { failed: true }),
            );
            started[key] = { ...record, target, pending: request, stale: false };
            return request;
          });
          if (Object.keys(started).length > 0) updateRecords((records) => ({ ...records, ...started }));
          await Promise.all(requests);
        },
        invalidate(filter) {
          updateRecords((records) => {
            const affected = Object.entries(records).filter(([, record]) => matches(record.target, filter));
            if (affected.length === 0) return records;
            const updated = { ...records };
            for (const [key, record] of affected) {
              updated[key] = { ...record, pending: undefined, stale: true };
            }
            return updated;
          });
        },
        remove(filter) {
          updateRecords((records) => {
            const affected = Object.entries(records).filter(([, record]) => matches(record.target, filter));
            if (affected.length === 0) return records;
            const updated = { ...records };
            for (const [key] of affected) delete updated[key];
            return updated;
          });
        },
      };
    },
    {
      name: "arx.ui.assetBalanceSnapshots",
      partialize: ({ records }) => ({
        records: Object.fromEntries(
          Object.entries(records)
            .filter(([, record]) => record.snapshot !== undefined)
            .map(([key, { target, snapshot }]) => [key, { target, snapshot }]),
        ),
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn("[arx:ui] Could not restore saved asset balances.", error);
      },
    },
  ),
);
