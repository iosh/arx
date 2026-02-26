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
    activeChainRef: ChainRef;
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

  const safeParse = (value: unknown): NetworkPreferencesRecord | null => {
    const parsed = NetworkPreferencesRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  const emitChanged = (next: NetworkPreferencesRecord) => {
    changed.emit({ next });
  };

  const get = async (): Promise<NetworkPreferencesRecord | null> => {
    const record = await port.get();
    if (!record) return null;
    return safeParse(record);
  };

  const update = async (params: UpdateNetworkPreferencesParams): Promise<NetworkPreferencesRecord> => {
    return await run(async () => {
      const base = safeParse(await port.get());

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
        activeChainRef: params.activeChainRef ?? base?.activeChainRef ?? defaults.activeChainRef,
        rpc: nextRpc,
        updatedAt: clock(),
      });

      await port.put(next);
      emitChanged(next);
      return next;
    });
  };

  const setActiveChainRef = async (chainRef: ChainRef) => update({ activeChainRef: chainRef });

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
    update,
    setActiveChainRef,
    setRpcPreferences,
    clearRpcPreferences,
    patchRpcPreference,
  };
};
