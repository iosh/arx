import type { RpcEndpoint } from "../../../chains/definition.js";
import type { ChainRef } from "../../../chains/ids.js";
import { areRpcEndpointsEqual, assertNonEmptyRpcEndpoints } from "../../../chains/rpc/config.js";
import { OWNER_CHANGED } from "../../../events/ownerChanged.js";
import type { Messenger } from "../../../messenger/index.js";
import type { ChainRpcEndpointOverrideRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import type { ChainRpcEndpointOverridesPort } from "./port.js";
import { CHAIN_RPC_ENDPOINT_OVERRIDES_STORE_CHANGED } from "./topics.js";
import type { ChainRpcEndpointOverridesChangedPayload, ChainRpcEndpointOverridesService } from "./types.js";

const cloneRpcEndpoints = (rpcEndpoints: readonly RpcEndpoint[]): RpcEndpoint[] =>
  structuredClone(rpcEndpoints) as RpcEndpoint[];

export type CreateChainRpcEndpointOverridesServiceOptions = {
  messenger: Messenger;
  port: ChainRpcEndpointOverridesPort;
  now?: () => number;
};

export const createChainRpcEndpointOverridesService = ({
  messenger,
  port,
  now,
}: CreateChainRpcEndpointOverridesServiceOptions): ChainRpcEndpointOverridesService => {
  const clock = now ?? Date.now;
  const run = createSerialQueue();
  const cache = new Map<ChainRef, ChainRpcEndpointOverrideRecord>();

  const toRecord = (record: ChainRpcEndpointOverrideRecord): ChainRpcEndpointOverrideRecord => {
    return {
      chainRef: record.chainRef,
      rpcEndpoints: cloneRpcEndpoints(record.rpcEndpoints),
      updatedAt: record.updatedAt,
    };
  };

  const get = async (chainRef: ChainRef): Promise<ChainRpcEndpointOverrideRecord | null> => {
    const record = await port.get(chainRef);
    if (!record) {
      cache.delete(chainRef);
      return null;
    }
    cache.set(chainRef, record);
    return toRecord(record);
  };

  const getAll = async (): Promise<ChainRpcEndpointOverrideRecord[]> => {
    const records = await port.list();
    cache.clear();
    for (const record of records) {
      cache.set(record.chainRef, record);
    }
    return records.map((record) => toRecord(record));
  };

  const readEndpointOverride = (chainRef: ChainRef): RpcEndpoint[] | null => {
    const record = cache.get(chainRef);
    return record ? cloneRpcEndpoints(record.rpcEndpoints) : null;
  };

  const publishRpcChanged = (chainRef: ChainRef) => {
    messenger.publish(OWNER_CHANGED, { topic: "network", change: "rpc", chainRef });
  };

  const setEndpointOverride = async (
    chainRef: ChainRef,
    endpoints: RpcEndpoint[],
  ): Promise<ChainRpcEndpointOverrideRecord> => {
    const rpcEndpoints = assertNonEmptyRpcEndpoints(chainRef, endpoints);

    return await run(async () => {
      const previous = await port.get(chainRef);
      if (previous && areRpcEndpointsEqual(previous.rpcEndpoints, rpcEndpoints)) {
        const previousRecord = toRecord(previous);
        cache.set(chainRef, previousRecord);
        return toRecord(previousRecord);
      }

      const next: ChainRpcEndpointOverrideRecord = {
        chainRef,
        rpcEndpoints,
        updatedAt: clock(),
      };

      await port.upsert(next);
      const clonedNext = toRecord(next);
      cache.set(chainRef, clonedNext);
      const payload: ChainRpcEndpointOverridesChangedPayload = {
        chainRef,
        previous: previous ? toRecord(previous) : null,
        next: toRecord(clonedNext),
      };
      messenger.publish(CHAIN_RPC_ENDPOINT_OVERRIDES_STORE_CHANGED, payload);
      publishRpcChanged(chainRef);
      return toRecord(clonedNext);
    });
  };

  const clearEndpointOverride = async (chainRef: ChainRef): Promise<void> => {
    await run(async () => {
      const previous = await port.get(chainRef);
      if (!previous) {
        cache.delete(chainRef);
        return;
      }

      await port.remove(chainRef);
      cache.delete(chainRef);
      messenger.publish(CHAIN_RPC_ENDPOINT_OVERRIDES_STORE_CHANGED, {
        chainRef,
        previous: toRecord(previous),
        next: null,
      });
      publishRpcChanged(chainRef);
    });
  };

  return {
    subscribeChanged: (handler) => messenger.subscribe(CHAIN_RPC_ENDPOINT_OVERRIDES_STORE_CHANGED, handler),
    get,
    getAll,
    readEndpointOverride,
    setEndpointOverride,
    clearEndpointOverride,
  };
};
