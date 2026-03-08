import type { ChainRef } from "../../../chains/ids.js";
import {
  type NetworkPreferencesRecord,
  NetworkPreferencesRecordSchema,
  type NetworkRpcPreference,
} from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import type { NetworkPreferencesPort } from "./port.js";
import type {
  NetworkPreferencesChangedPayload,
  NetworkPreferencesService,
  UpdateNetworkPreferencesParams,
} from "./types.js";

export type CreateNetworkPreferencesServiceOptions = {
  port: NetworkPreferencesPort;
  defaults: {
    selectedChainRef: ChainRef;
    activeChainByNamespace: Record<string, ChainRef>;
  };
  now?: () => number;
};

export const createNetworkPreferencesService = ({
  port,
  defaults,
  now,
}: CreateNetworkPreferencesServiceOptions): NetworkPreferencesService => {
  const clock = now ?? Date.now;
  const changed = createSignal<NetworkPreferencesChangedPayload>();
  const run = createSerialQueue();
  let cached: NetworkPreferencesRecord | null = null;

  const getDefaultSelectedChainRef = () => defaults.selectedChainRef;
  const getDefaultActiveChainByNamespace = () => ({ ...defaults.activeChainByNamespace });

  const safeParse = (value: unknown): NetworkPreferencesRecord | null => {
    const parsed = NetworkPreferencesRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  const emitChanged = (next: NetworkPreferencesRecord) => {
    cached = next;
    changed.emit({ next });
  };

  const get = async (): Promise<NetworkPreferencesRecord | null> => {
    const record = await port.get();
    if (!record) {
      cached = null;
      return null;
    }
    const parsed = safeParse(record);
    cached = parsed;
    return parsed;
  };

  const getSnapshot = (): NetworkPreferencesRecord | null => cached;

  const getSelectedChainRef = (): ChainRef => cached?.selectedChainRef ?? getDefaultSelectedChainRef();

  const getActiveChainByNamespace = (): Record<string, ChainRef> => {
    return {
      ...getDefaultActiveChainByNamespace(),
      ...(cached?.activeChainByNamespace ?? {}),
    };
  };

  const getActiveChainRef = (namespace: string): ChainRef | null => {
    const normalized = namespace.trim();
    if (normalized.length === 0) {
      return null;
    }
    return getActiveChainByNamespace()[normalized] ?? null;
  };

  const update = async (params: UpdateNetworkPreferencesParams): Promise<NetworkPreferencesRecord> => {
    return await run(async () => {
      const base = safeParse(await port.get());
      cached = base;

      const nextSelectedChainRef = params.selectedChainRef ?? base?.selectedChainRef ?? getDefaultSelectedChainRef();

      const nextActiveBase =
        params.activeChainByNamespace === undefined
          ? { ...getDefaultActiveChainByNamespace(), ...(base?.activeChainByNamespace ?? {}) }
          : { ...params.activeChainByNamespace };

      const nextActiveChainByNamespace: Record<string, ChainRef> = { ...nextActiveBase };
      if (params.activeChainByNamespacePatch) {
        for (const [namespace, chainRef] of Object.entries(params.activeChainByNamespacePatch)) {
          const normalizedNamespace = namespace.trim();
          if (normalizedNamespace.length === 0) {
            continue;
          }
          if (chainRef === null) {
            delete nextActiveChainByNamespace[normalizedNamespace];
            continue;
          }
          nextActiveChainByNamespace[normalizedNamespace] = chainRef;
        }
      }

      const nextRpcBase =
        "clearRpc" in params && params.clearRpc ? {} : params.rpc === undefined ? (base?.rpc ?? {}) : params.rpc;

      const nextRpc: Record<ChainRef, NetworkRpcPreference> = { ...nextRpcBase };
      if (params.rpcPatch) {
        for (const [chainRef, pref] of Object.entries(params.rpcPatch) as Array<
          [ChainRef, NetworkRpcPreference | null]
        >) {
          if (pref === null) {
            delete nextRpc[chainRef];
          } else {
            nextRpc[chainRef] = pref;
          }
        }
      }

      const next: NetworkPreferencesRecord = NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        selectedChainRef: nextSelectedChainRef,
        activeChainByNamespace: nextActiveChainByNamespace,
        rpc: nextRpc,
        updatedAt: clock(),
      });

      await port.put(next);
      emitChanged(next);
      return next;
    });
  };

  const setSelectedChainRef = async (chainRef: ChainRef) => {
    return update({ selectedChainRef: chainRef });
  };

  const setActiveChainRef = async (chainRef: ChainRef) => {
    const [namespace] = chainRef.split(":");
    if (!namespace) {
      throw new Error(`Invalid chainRef: ${chainRef}`);
    }
    return update({ activeChainByNamespacePatch: { [namespace]: chainRef } });
  };

  const setRpcPreferences = async (rpc: Record<ChainRef, NetworkRpcPreference>) => update({ rpc });

  const clearRpcPreferences = async () => update({ clearRpc: true });

  const patchRpcPreference = async (params: { chainRef: ChainRef; preference: NetworkRpcPreference | null }) => {
    return update({
      rpcPatch: { [params.chainRef]: params.preference } as Record<ChainRef, NetworkRpcPreference | null>,
    });
  };

  return {
    subscribeChanged: changed.subscribe,

    get,
    getSnapshot,
    getSelectedChainRef,
    getActiveChainByNamespace,
    getActiveChainRef,
    update,
    setSelectedChainRef,
    setActiveChainRef,
    setRpcPreferences,
    clearRpcPreferences,
    patchRpcPreference,
  };
};
