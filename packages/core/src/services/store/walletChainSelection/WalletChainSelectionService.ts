import { getChainRefNamespace } from "../../../chains/caip.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { WalletChainSelectionRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import type { WalletChainSelectionPort } from "./port.js";
import type {
  UpdateWalletChainSelectionParams,
  WalletChainSelectionChangedPayload,
  WalletChainSelectionService,
} from "./types.js";

export type CreateWalletChainSelectionServiceOptions = {
  port: WalletChainSelectionPort;
  defaults: {
    selectedNamespace: string;
    chainRefByNamespace: Record<string, ChainRef>;
  };
  now?: () => number;
};

export const createWalletChainSelectionService = ({
  port,
  defaults,
  now,
}: CreateWalletChainSelectionServiceOptions): WalletChainSelectionService => {
  const clock = now ?? Date.now;
  const changed = createSignal<WalletChainSelectionChangedPayload>();
  const run = createSerialQueue();
  let cached: WalletChainSelectionRecord | null = null;

  const getDefaultSelectedNamespace = () => defaults.selectedNamespace;
  const getDefaultChainRefByNamespace = () => ({ ...defaults.chainRefByNamespace });

  const emitChanged = (previous: WalletChainSelectionRecord | null, next: WalletChainSelectionRecord) => {
    cached = next;
    changed.emit({
      previous: previous ? structuredClone(previous) : null,
      next: structuredClone(next),
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
    subscribeChanged: changed.subscribe,
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
