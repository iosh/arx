import type { ChainRef } from "../../../chains/ids.js";
import type { RpcEndpoint } from "../../../chains/metadata.js";
import { areRpcEndpointsEqual, assertNonEmptyRpcEndpoints } from "../../../chains/rpc/config.js";
import type { ChainRpcDefaultEndpointsRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import type { ChainRpcDefaultEndpointsPort } from "./port.js";
import type {
  ChainRpcDefaultEndpointsChangedPayload,
  ChainRpcDefaultEndpointsSeed,
  ChainRpcDefaultEndpointsService,
} from "./types.js";

const cloneRpcEndpoints = (rpcEndpoints: readonly RpcEndpoint[]): RpcEndpoint[] =>
  structuredClone(rpcEndpoints) as RpcEndpoint[];

export type CreateChainRpcDefaultEndpointsServiceOptions = {
  port: ChainRpcDefaultEndpointsPort;
  now?: () => number;
};

export const createChainRpcDefaultEndpointsService = ({
  port,
  now,
}: CreateChainRpcDefaultEndpointsServiceOptions): ChainRpcDefaultEndpointsService => {
  const clock = now ?? Date.now;
  const changed = createSignal<ChainRpcDefaultEndpointsChangedPayload>();
  const run = createSerialQueue();
  const cache = new Map<ChainRef, ChainRpcDefaultEndpointsRecord>();

  const toRecord = (record: ChainRpcDefaultEndpointsRecord): ChainRpcDefaultEndpointsRecord => ({
    chainRef: record.chainRef,
    rpcEndpoints: cloneRpcEndpoints(record.rpcEndpoints),
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

  const setDefaultEndpoints = async (
    chainRef: ChainRef,
    endpoints: readonly RpcEndpoint[],
  ): Promise<ChainRpcDefaultEndpointsRecord> => {
    const rpcEndpoints = assertNonEmptyRpcEndpoints(chainRef, endpoints);

    return await run(async () => {
      const previous = await port.get(chainRef);
      const previousRecord = previous ? toRecord(previous) : null;
      const shouldWrite = !previousRecord || !areRpcEndpointsEqual(previousRecord.rpcEndpoints, rpcEndpoints);
      const next: ChainRpcDefaultEndpointsRecord = {
        chainRef,
        rpcEndpoints,
        updatedAt: shouldWrite ? clock() : previousRecord.updatedAt,
      };

      if (shouldWrite) {
        await port.upsert(next);
      }

      const clonedNext = toRecord(next);
      cache.set(chainRef, clonedNext);

      if (shouldWrite) {
        changed.emit({
          chainRef,
          previous: previousRecord,
          next: toRecord(clonedNext),
        });
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

        if (previous && areRpcEndpointsEqual(previous.rpcEndpoints, rpcEndpoints)) {
          cache.set(seed.chainRef, toRecord(previous));
          continue;
        }

        const next: ChainRpcDefaultEndpointsRecord = {
          chainRef: seed.chainRef,
          rpcEndpoints,
          updatedAt: clock(),
        };
        await port.upsert(next);
        cache.set(seed.chainRef, toRecord(next));
        changed.emit({
          chainRef: seed.chainRef,
          previous: previous ? toRecord(previous) : null,
          next: toRecord(next),
        });
      }

      for (const previous of previousByChainRef.values()) {
        if (nextChainRefs.has(previous.chainRef)) {
          continue;
        }

        await port.remove(previous.chainRef);
        cache.delete(previous.chainRef);
        changed.emit({
          chainRef: previous.chainRef,
          previous: toRecord(previous),
          next: null,
        });
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
    readDefaultEndpoints,
    setDefaultEndpoints,
    replaceDefaultEndpoints,
    clearDefaultEndpoints,
  };
};
