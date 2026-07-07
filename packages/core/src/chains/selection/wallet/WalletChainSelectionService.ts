import { getChainRefNamespace } from "../../caip.js";
import type { ChainRef } from "../../ids.js";
import { OWNER_CHANGED } from "../../../events/ownerChanged.js";
import type { Messenger } from "../../../messenger/index.js";
import type { WalletChainSelectionRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../../../utils/serialQueue.js";
import type { WalletChainSelectionPort } from "./port.js";
import { WALLET_CHAIN_SELECTION_STORE_CHANGED } from "./topics.js";
import type { UpdateWalletChainSelectionParams, WalletChainSelectionService } from "./types.js";

export type CreateWalletChainSelectionServiceOptions = {
  messenger: Messenger;
  port: WalletChainSelectionPort;
  defaults: {
    selectedNamespace: string;
    chainRefByNamespace: Record<string, ChainRef>;
  };
  now?: () => number;
};

const areChainRefRecordsEqual = (left: Record<string, ChainRef>, right: Record<string, ChainRef>): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
};

const areWalletChainSelectionRecordsEqual = (
  left: WalletChainSelectionRecord,
  right: WalletChainSelectionRecord,
): boolean =>
  left.selectedNamespace === right.selectedNamespace &&
  areChainRefRecordsEqual(left.chainRefByNamespace, right.chainRefByNamespace);

export const createWalletChainSelectionService = ({
  messenger,
  port,
  defaults,
  now,
}: CreateWalletChainSelectionServiceOptions): WalletChainSelectionService => {
  const clock = now ?? Date.now;
  const run = createSerialQueue();
  let cached: WalletChainSelectionRecord | null = null;

  const getDefaultSelectedNamespace = () => defaults.selectedNamespace;
  const getDefaultChainRefByNamespace = () => ({ ...defaults.chainRefByNamespace });

  const emitChanged = (previous: WalletChainSelectionRecord | null, next: WalletChainSelectionRecord) => {
    cached = next;
    messenger.publish(WALLET_CHAIN_SELECTION_STORE_CHANGED, {
      previous: previous ? structuredClone(previous) : null,
      next: structuredClone(next),
    });
    messenger.publish(OWNER_CHANGED, {
      topic: "network",
      change: "selection",
      namespace: next.selectedNamespace,
      chainRef: next.chainRefByNamespace[next.selectedNamespace] ?? null,
    });
  };

  const get = async (): Promise<WalletChainSelectionRecord | null> => {
    const record = await port.get();
    cached = record;
    return record ? structuredClone(record) : null;
  };

  const getSnapshot = (): WalletChainSelectionRecord | null => (cached ? structuredClone(cached) : null);

  const getSelectedNamespace = (): string => cached?.selectedNamespace ?? getDefaultSelectedNamespace();

  const getChainRefByNamespace = (): Record<string, ChainRef> => {
    return {
      ...getDefaultChainRefByNamespace(),
      ...(cached?.chainRefByNamespace ?? {}),
    };
  };

  const getSelectedChainRef = (namespace: string): ChainRef | null => {
    const namespaceKey = namespace.trim();
    if (namespaceKey.length === 0) {
      return null;
    }
    return getChainRefByNamespace()[namespaceKey] ?? null;
  };

  const update = async (params: UpdateWalletChainSelectionParams): Promise<WalletChainSelectionRecord> => {
    return await run(async () => {
      const previous = await port.get();
      cached = previous;

      const nextBase =
        params.chainRefByNamespace === undefined
          ? { ...getDefaultChainRefByNamespace(), ...(previous?.chainRefByNamespace ?? {}) }
          : { ...params.chainRefByNamespace };

      const nextChainRefByNamespace: Record<string, ChainRef> = { ...nextBase };
      if (params.chainRefByNamespacePatch) {
        for (const [namespace, chainRef] of Object.entries(params.chainRefByNamespacePatch)) {
          const namespaceKey = namespace.trim();
          if (namespaceKey.length === 0) {
            continue;
          }
          if (chainRef === null) {
            delete nextChainRefByNamespace[namespaceKey];
            continue;
          }
          nextChainRefByNamespace[namespaceKey] = chainRef;
        }
      }

      const nextSelectedNamespace =
        params.selectedNamespace?.trim() || previous?.selectedNamespace || getDefaultSelectedNamespace();

      const next: WalletChainSelectionRecord = {
        id: "wallet-chain-selection",
        selectedNamespace: nextSelectedNamespace,
        chainRefByNamespace: nextChainRefByNamespace,
        updatedAt: clock(),
      };

      if (previous && areWalletChainSelectionRecordsEqual(previous, next)) {
        cached = previous;
        return structuredClone(previous);
      }

      await port.put(next);
      emitChanged(previous, next);
      return structuredClone(next);
    });
  };

  const selectNamespace = async (namespace: string) => {
    return await update({ selectedNamespace: namespace });
  };

  const selectChain = async (chainRef: ChainRef) => {
    const namespace = getChainRefNamespace(chainRef);
    return await update({
      selectedNamespace: namespace,
      chainRefByNamespacePatch: { [namespace]: chainRef },
    });
  };

  return {
    subscribeChanged: (handler) => messenger.subscribe(WALLET_CHAIN_SELECTION_STORE_CHANGED, handler),
    get,
    getSnapshot,
    getSelectedNamespace,
    getChainRefByNamespace,
    getSelectedChainRef,
    update,
    selectNamespace,
    selectChain,
  };
};
