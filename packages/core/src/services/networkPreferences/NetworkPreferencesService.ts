import { EventEmitter } from "eventemitter3";

import type { ChainRef } from "../../chains/ids.js";
import {
  type NetworkPreferencesRecord,
  NetworkPreferencesRecordSchema,
  type NetworkRpcPreference,
} from "../../storage/records.js";
import type { NetworkPreferencesPort } from "./port.js";
import type {
  NetworkPreferencesChangedPayload,
  NetworkPreferencesService,
  UpdateNetworkPreferencesParams,
} from "./types.js";

type ChangedEvent = "changed";

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
  const emitter = new EventEmitter<ChangedEvent>();
  const clock = now ?? Date.now;

  const safeParse = (value: unknown): NetworkPreferencesRecord | null => {
    const parsed = NetworkPreferencesRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  let writeQueue: Promise<NetworkPreferencesRecord> = Promise.resolve(
    NetworkPreferencesRecordSchema.parse({
      id: "network-preferences",
      activeChainRef: defaults.activeChainRef,
      rpc: {},
      updatedAt: 0,
    }),
  );

  const emitChanged = (next: NetworkPreferencesRecord) => {
    const payload: NetworkPreferencesChangedPayload = { next };
    emitter.emit("changed", payload);
  };

  const get = async (): Promise<NetworkPreferencesRecord | null> => {
    const record = await port.get();
    if (!record) return null;
    return safeParse(record);
  };

  const upsert = async (params: UpdateNetworkPreferencesParams): Promise<NetworkPreferencesRecord> => {
    writeQueue = writeQueue
      .catch(() => {
        return NetworkPreferencesRecordSchema.parse({
          id: "network-preferences",
          activeChainRef: defaults.activeChainRef,
          rpc: {},
          updatedAt: 0,
        });
      })
      .then(async () => {
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

    return await writeQueue;
  };

  const setActiveChainRef = async (chainRef: ChainRef) => upsert({ activeChainRef: chainRef });

  const setRpcPreferences = async (rpc: Record<ChainRef, NetworkRpcPreference>) => upsert({ rpc });

  const clearRpcPreferences = async () => upsert({ clearRpc: true });

  const patchRpcPreference = async (params: { chainRef: ChainRef; preference: NetworkRpcPreference | null }) => {
    return upsert({
      rpcPatch: { [params.chainRef]: params.preference } as Record<ChainRef, NetworkRpcPreference | null>,
    });
  };

  return {
    on(event, handler) {
      if (event !== "changed") return;
      emitter.on("changed", handler);
    },
    off(event, handler) {
      if (event !== "changed") return;
      emitter.off("changed", handler);
    },

    get,
    upsert,
    setActiveChainRef,
    setRpcPreferences,
    clearRpcPreferences,
    patchRpcPreference,
  };
};
