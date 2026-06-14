import type { ChainRef } from "../../../chains/ids.js";
import type { RpcEndpoint } from "../../../chains/metadata.js";
import { assertNonEmptyRpcEndpoints } from "../../../chains/rpc/config.js";
import type { ChainRpcEndpointOverrideRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import type { ChainRpcEndpointOverridesPort } from "./port.js";
import type { ChainRpcEndpointOverridesService } from "./types.js";

const cloneRpcEndpoints = (rpcEndpoints: readonly RpcEndpoint[]): RpcEndpoint[] =>
  structuredClone(rpcEndpoints) as RpcEndpoint[];

export type CreateChainRpcEndpointOverridesServiceOptions = {
  port: ChainRpcEndpointOverridesPort;
  now?: () => number;
};

export const createChainRpcEndpointOverridesService = ({
  port,
  now,
}: CreateChainRpcEndpointOverridesServiceOptions): ChainRpcEndpointOverridesService => {
  const clock = now ?? Date.now;
  const changed = createSignal<{
    chainRef: ChainRef;
    previous: ChainRpcEndpointOverrideRecord | null;
    next: ChainRpcEndpointOverrideRecord | null;
  }>();
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

  const setEndpointOverride = async (
    chainRef: ChainRef,
    endpoints: RpcEndpoint[],
  ): Promise<ChainRpcEndpointOverrideRecord> => {
    const rpcEndpoints = assertNonEmptyRpcEndpoints(chainRef, endpoints);

    return await run(async () => {
      const previous = await port.get(chainRef);
      const next: ChainRpcEndpointOverrideRecord = {
        chainRef,
        rpcEndpoints,
        updatedAt: clock(),
      };

      await port.upsert(next);
      const clonedNext = toRecord(next);
      cache.set(chainRef, clonedNext);
      changed.emit({
        chainRef,
        previous: previous ? toRecord(previous) : null,
        next: toRecord(clonedNext),
      });
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
      changed.emit({
        chainRef,
        previous: toRecord(previous),
        next: null,
      });
    });
  };

  return {
    subscribeChanged: changed.subscribe,
    get,
    getAll,
    readEndpointOverride,
    setEndpointOverride,
    clearEndpointOverride,
  };
};
