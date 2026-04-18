import { getChainRefNamespace } from "../../../chains/caip.js";
import type { ChainRef } from "../../../chains/ids.js";
import { type NetworkSelectionRecord, NetworkSelectionRecordSchema } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import type { NetworkSelectionPort } from "./port.js";
import type { NetworkSelectionChangedPayload, NetworkSelectionService, UpdateNetworkSelectionParams } from "./types.js";

export type CreateNetworkSelectionServiceOptions = {
  port: NetworkSelectionPort;
  defaults: {
    selectedNamespace: string;
    chainRefByNamespace: Record<string, ChainRef>;
  };
  now?: () => number;
};

export const createNetworkSelectionService = ({
  port,
  defaults,
  now,
}: CreateNetworkSelectionServiceOptions): NetworkSelectionService => {
  const clock = now ?? Date.now;
  const changed = createSignal<NetworkSelectionChangedPayload>();
  const run = createSerialQueue();
  let cached: NetworkSelectionRecord | null = null;

  const getDefaultSelectedNamespace = () => defaults.selectedNamespace;
  const getDefaultChainRefByNamespace = () => ({ ...defaults.chainRefByNamespace });

  const safeParse = (value: unknown): NetworkSelectionRecord | null => {
    const parsed = NetworkSelectionRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  const emitChanged = (previous: NetworkSelectionRecord | null, next: NetworkSelectionRecord) => {
    cached = next;
    changed.emit({
      previous: previous ? structuredClone(previous) : null,
      next: structuredClone(next),
    });
  };

  const get = async (): Promise<NetworkSelectionRecord | null> => {
    const record = safeParse(await port.get());
    cached = record;
    return record ? structuredClone(record) : null;
  };

  const getSnapshot = (): NetworkSelectionRecord | null => (cached ? structuredClone(cached) : null);

  const getSelectedNamespace = (): string => cached?.selectedNamespace ?? getDefaultSelectedNamespace();

  const getChainRefByNamespace = (): Record<string, ChainRef> => {
    return {
      ...getDefaultChainRefByNamespace(),
      ...(cached?.chainRefByNamespace ?? {}),
    };
  };

  const getSelectedChainRef = (namespace: string): ChainRef | null => {
    const normalizedNamespace = namespace.trim();
    if (normalizedNamespace.length === 0) {
      return null;
    }
    return getChainRefByNamespace()[normalizedNamespace] ?? null;
  };

  const update = async (params: UpdateNetworkSelectionParams): Promise<NetworkSelectionRecord> => {
    return await run(async () => {
      const previous = safeParse(await port.get());
      cached = previous;

      const nextBase =
        params.chainRefByNamespace === undefined
          ? { ...getDefaultChainRefByNamespace(), ...(previous?.chainRefByNamespace ?? {}) }
          : { ...params.chainRefByNamespace };

      const nextChainRefByNamespace: Record<string, ChainRef> = { ...nextBase };
      if (params.chainRefByNamespacePatch) {
        for (const [namespace, chainRef] of Object.entries(params.chainRefByNamespacePatch)) {
          const normalizedNamespace = namespace.trim();
          if (normalizedNamespace.length === 0) {
            continue;
          }
          if (chainRef === null) {
            delete nextChainRefByNamespace[normalizedNamespace];
            continue;
          }
          nextChainRefByNamespace[normalizedNamespace] = chainRef;
        }
      }

      const nextSelectedNamespace =
        params.selectedNamespace?.trim() || previous?.selectedNamespace || getDefaultSelectedNamespace();

      const next = NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        selectedNamespace: nextSelectedNamespace,
        chainRefByNamespace: nextChainRefByNamespace,
        updatedAt: clock(),
      });

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
