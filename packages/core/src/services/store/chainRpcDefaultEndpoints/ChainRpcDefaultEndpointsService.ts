import type { RpcEndpoint } from "../../../chains/definition.js";
import type { ChainRef } from "../../../chains/ids.js";
import { areRpcEndpointsEqual, assertNonEmptyRpcEndpoints } from "../../../chains/rpc/config.js";
import { OWNER_CHANGED } from "../../../events/ownerChanged.js";
import type { Messenger } from "../../../messenger/index.js";
import type { ChainRpcDefaultEndpointsRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import type { ChainRpcDefaultEndpointsPort } from "./port.js";
import { CHAIN_RPC_DEFAULT_ENDPOINTS_STORE_CHANGED } from "./topics.js";
import type { ChainRpcDefaultEndpointsSeed, ChainRpcDefaultEndpointsService } from "./types.js";

const cloneRpcEndpoints = (rpcEndpoints: readonly RpcEndpoint[]): RpcEndpoint[] =>
  structuredClone(rpcEndpoints) as RpcEndpoint[];

export type CreateChainRpcDefaultEndpointsServiceOptions = {
  messenger: Messenger;
  port: ChainRpcDefaultEndpointsPort;
  now?: () => number;
};

export const createChainRpcDefaultEndpointsService = ({
  messenger,
  port,
  now,
}: CreateChainRpcDefaultEndpointsServiceOptions): ChainRpcDefaultEndpointsService => {
  const clock = now ?? Date.now;
  const run = createSerialQueue();
  const cache = new Map<ChainRef, ChainRpcDefaultEndpointsRecord>();

  const toRecord = (record: ChainRpcDefaultEndpointsRecord): ChainRpcDefaultEndpointsRecord => ({
    chainRef: record.chainRef,
    rpcEndpoints: cloneRpcEndpoints(record.rpcEndpoints),
    source: record.source ?? "request",
    updatedAt: record.updatedAt,
  });

  const get = async (chainRef: ChainRef): Promise<ChainRpcDefaultEndpointsRecord | null> => {
    const record = await port.get(chainRef);
    if (!record) {
      cache.delete(chainRef);
      return null;
    }

    const cloned = toRecord(record);
    cache.set(chainRef, cloned);
    return toRecord(cloned);
  };

  const getAll = async (): Promise<ChainRpcDefaultEndpointsRecord[]> => {
    const records = await port.list();
    cache.clear();
    for (const record of records) {
      cache.set(record.chainRef, toRecord(record));
    }
    return records.map((record) => toRecord(record));
  };

  const readDefaultEndpoints = (chainRef: ChainRef): RpcEndpoint[] | null => {
    const record = cache.get(chainRef);
    return record ? cloneRpcEndpoints(record.rpcEndpoints) : null;
  };

  const publishRpcChanged = (chainRef: ChainRef) => {
    messenger.publish(OWNER_CHANGED, { topic: "network", change: "rpc", chainRef });
  };

  const setDefaultEndpoints = async (
    chainRef: ChainRef,
    endpoints: readonly RpcEndpoint[],
    source: ChainRpcDefaultEndpointsRecord["source"],
  ): Promise<ChainRpcDefaultEndpointsRecord> => {
    const rpcEndpoints = assertNonEmptyRpcEndpoints(chainRef, endpoints);

    return await run(async () => {
      const previous = await port.get(chainRef);
      const previousRecord = previous ? toRecord(previous) : null;
      const shouldWrite =
        !previousRecord ||
        previousRecord.source !== source ||
        !areRpcEndpointsEqual(previousRecord.rpcEndpoints, rpcEndpoints);
      const next: ChainRpcDefaultEndpointsRecord = {
        chainRef,
        rpcEndpoints,
        source,
        updatedAt: shouldWrite ? clock() : previousRecord.updatedAt,
      };

      if (shouldWrite) {
        await port.upsert(next);
      }

      const clonedNext = toRecord(next);
      cache.set(chainRef, clonedNext);

      if (shouldWrite) {
        messenger.publish(CHAIN_RPC_DEFAULT_ENDPOINTS_STORE_CHANGED, {
          chainRef,
          previous: previousRecord,
          next: toRecord(clonedNext),
        });
        publishRpcChanged(chainRef);
      }

      return toRecord(clonedNext);
    });
  };

  const replaceDefaultEndpoints = async (seeds: readonly ChainRpcDefaultEndpointsSeed[]): Promise<void> => {
    await run(async () => {
      const records = await port.list();
      const previousByChainRef = new Map<ChainRef, ChainRpcDefaultEndpointsRecord>(
        records.map((record) => [record.chainRef, toRecord(record)]),
      );
      const nextChainRefs = new Set<ChainRef>();

      for (const seed of seeds) {
        const rpcEndpoints = assertNonEmptyRpcEndpoints(seed.chainRef, seed.rpcEndpoints);
        const previous = previousByChainRef.get(seed.chainRef) ?? null;
        nextChainRefs.add(seed.chainRef);

        if (previous?.source === "request") {
          cache.set(seed.chainRef, toRecord(previous));
          continue;
        }

        if (previous?.source === seed.source && areRpcEndpointsEqual(previous.rpcEndpoints, rpcEndpoints)) {
          cache.set(seed.chainRef, toRecord(previous));
          continue;
        }

        const next: ChainRpcDefaultEndpointsRecord = {
          chainRef: seed.chainRef,
          rpcEndpoints,
          source: seed.source,
          updatedAt: clock(),
        };
        await port.upsert(next);
        cache.set(seed.chainRef, toRecord(next));
        messenger.publish(CHAIN_RPC_DEFAULT_ENDPOINTS_STORE_CHANGED, {
          chainRef: seed.chainRef,
          previous: previous ? toRecord(previous) : null,
          next: toRecord(next),
        });
        publishRpcChanged(seed.chainRef);
      }

      for (const previous of previousByChainRef.values()) {
        if (nextChainRefs.has(previous.chainRef)) {
          continue;
        }
        if (previous.source === "request") {
          cache.set(previous.chainRef, toRecord(previous));
          continue;
        }

        await port.remove(previous.chainRef);
        cache.delete(previous.chainRef);
        messenger.publish(CHAIN_RPC_DEFAULT_ENDPOINTS_STORE_CHANGED, {
          chainRef: previous.chainRef,
          previous: toRecord(previous),
          next: null,
        });
        publishRpcChanged(previous.chainRef);
      }
    });
  };

  const clearDefaultEndpoints = async (chainRef: ChainRef): Promise<void> => {
    await run(async () => {
      const previous = await port.get(chainRef);
      if (!previous) {
        cache.delete(chainRef);
        return;
      }

      await port.remove(chainRef);
      cache.delete(chainRef);
      messenger.publish(CHAIN_RPC_DEFAULT_ENDPOINTS_STORE_CHANGED, {
        chainRef,
        previous: toRecord(previous),
        next: null,
      });
      publishRpcChanged(chainRef);
    });
  };

  return {
    subscribeChanged: (handler) => messenger.subscribe(CHAIN_RPC_DEFAULT_ENDPOINTS_STORE_CHANGED, handler),
    get,
    getAll,
    readDefaultEndpoints,
    setDefaultEndpoints,
    replaceDefaultEndpoints,
    clearDefaultEndpoints,
  };
};
