import type { ChainRef } from "../../chains/ids.js";
import type { NetworkController, RpcStrategyConfig } from "../../controllers/network/types.js";
import type { NetworkRpcPreferenceRecord } from "../../db/records.js";
import type { NetworkRpcPort } from "../../storage/types.js";

type NetworkRpcPreference = { activeIndex: number; strategy: RpcStrategyConfig };

type CreateNetworkRpcSyncOptions = {
  port: NetworkRpcPort;
  network: NetworkController;
  now?: () => number;
  logger?: (message: string, error: unknown) => void;
  debounceMs?: number;
};

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, next) => {
    if (!next || typeof next !== "object") return next;
    if (seen.has(next as object)) return "[Circular]";
    seen.add(next as object);

    if (Array.isArray(next)) return next;
    const record = next as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, record[k]]),
    );
  });
};

const isSameStrategy = (a: RpcStrategyConfig, b: RpcStrategyConfig): boolean =>
  a.id === b.id && stableStringify(a.options ?? null) === stableStringify(b.options ?? null);

const isSamePreference = (a: NetworkRpcPreference, b: NetworkRpcPreference): boolean =>
  a.activeIndex === b.activeIndex && isSameStrategy(a.strategy, b.strategy);

const buildPreferences = (network: NetworkController): Map<ChainRef, NetworkRpcPreference> => {
  const state = network.getState();
  const entries: Array<[ChainRef, NetworkRpcPreference]> = Object.entries(state.rpc).map(
    ([chainRef, endpointState]) => {
      return [chainRef as ChainRef, { activeIndex: endpointState.activeIndex, strategy: endpointState.strategy }];
    },
  );
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return new Map(entries);
};

export const createNetworkRpcSync = ({
  port,
  network,
  now = Date.now,
  logger = console.warn,
  debounceMs = 750,
}: CreateNetworkRpcSyncOptions) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attached = false;
  let unsubscribe: (() => void) | null = null;

  // Tracks what we've written to storage (not what the network controller is currently doing).
  let lastPersisted = new Map<ChainRef, NetworkRpcPreference>();
  let pending = false;

  const schedule = () => {
    if (pending) return;
    pending = true;

    if (debounceMs <= 0) {
      void flush();
      return;
    }

    if (timer) return;
    timer = setTimeout(() => void flush(), debounceMs);
  };

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const next = buildPreferences(network);

    const toUpsert: NetworkRpcPreferenceRecord[] = [];
    const toRemove: ChainRef[] = [];

    for (const [chainRef, pref] of next.entries()) {
      const prev = lastPersisted.get(chainRef);
      if (!prev || !isSamePreference(prev, pref)) {
        toUpsert.push({
          chainRef,
          activeIndex: pref.activeIndex,
          strategy: pref.strategy,
          updatedAt: now(),
        });
      }
    }

    for (const chainRef of lastPersisted.keys()) {
      if (!next.has(chainRef)) {
        toRemove.push(chainRef);
      }
    }

    if (toUpsert.length === 0 && toRemove.length === 0) {
      pending = false;
      return;
    }

    try {
      if (toUpsert.length > 0) {
        await port.upsertMany(toUpsert);
      }
      for (const chainRef of toRemove) {
        await port.remove(chainRef);
      }
      lastPersisted = next;
    } catch (error) {
      logger("[persistence] failed to persist network rpc preferences", error);
    } finally {
      pending = false;
    }
  };

  const attach = () => {
    if (attached) return;
    attached = true;

    // Seed persisted state to the current preferences so we don't write on health-only updates.
    lastPersisted = buildPreferences(network);

    unsubscribe = network.onStateChanged(() => {
      const current = buildPreferences(network);
      let changed = false;

      if (current.size !== lastPersisted.size) {
        changed = true;
      } else {
        for (const [chainRef, pref] of current.entries()) {
          const prev = lastPersisted.get(chainRef);
          if (!prev || !isSamePreference(prev, pref)) {
            changed = true;
            break;
          }
        }
      }

      if (!changed) return;
      schedule();
    });
  };

  const detach = () => {
    if (!attached) return;
    attached = false;

    if (unsubscribe) {
      try {
        unsubscribe();
      } catch (error) {
        logger("[persistence] failed to unsubscribe network sync listener", error as any);
      }
      unsubscribe = null;
    }

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = false;
  };

  return { attach, detach };
};
