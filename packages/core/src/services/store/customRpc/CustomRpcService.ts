import type { ChainRef } from "../../../chains/ids.js";
import { type RpcEndpoint, rpcEndpointSchema } from "../../../chains/metadata.js";
import { type CustomRpcRecord, CustomRpcRecordSchema } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import type { CustomRpcPort } from "./port.js";
import type { CustomRpcService } from "./types.js";

const cloneRpcEndpoints = (rpcEndpoints: readonly RpcEndpoint[]): RpcEndpoint[] => {
  return rpcEndpoints.map((endpoint) => ({
    url: endpoint.url,
    type: endpoint.type,
    weight: endpoint.weight,
    headers: endpoint.headers ? { ...endpoint.headers } : undefined,
  }));
};

export type CreateCustomRpcServiceOptions = {
  port: CustomRpcPort;
  now?: () => number;
};

export const createCustomRpcService = ({ port, now }: CreateCustomRpcServiceOptions): CustomRpcService => {
  const clock = now ?? Date.now;
  const changed = createSignal<{
    chainRef: ChainRef;
    previous: CustomRpcRecord | null;
    next: CustomRpcRecord | null;
  }>();
  const run = createSerialQueue();
  const cache = new Map<ChainRef, CustomRpcRecord>();

  const toRecord = (record: CustomRpcRecord): CustomRpcRecord => {
    return CustomRpcRecordSchema.parse({
      chainRef: record.chainRef,
      rpcEndpoints: cloneRpcEndpoints(record.rpcEndpoints),
      updatedAt: record.updatedAt,
    });
  };

  const parseRecord = (value: unknown): CustomRpcRecord | null => {
    const parsed = CustomRpcRecordSchema.safeParse(value);
    return parsed.success ? toRecord(parsed.data) : null;
  };

  const get = async (chainRef: ChainRef): Promise<CustomRpcRecord | null> => {
    const record = parseRecord(await port.get(chainRef));
    if (!record) {
      cache.delete(chainRef);
      return null;
    }
    cache.set(chainRef, record);
    return toRecord(record);
  };

  const getAll = async (): Promise<CustomRpcRecord[]> => {
    const records = (await port.list()).map((record) => parseRecord(record)).filter((record) => record !== null);
    cache.clear();
    for (const record of records) {
      cache.set(record.chainRef, record);
    }
    return records.map((record) => toRecord(record));
  };

  const getRpcEndpoints = (chainRef: ChainRef): RpcEndpoint[] | null => {
    const record = cache.get(chainRef);
    return record ? cloneRpcEndpoints(record.rpcEndpoints) : null;
  };

  const set = async (chainRef: ChainRef, rpcEndpoints: RpcEndpoint[]): Promise<CustomRpcRecord> => {
    return await run(async () => {
      const previous = parseRecord(await port.get(chainRef));
      const next = CustomRpcRecordSchema.parse({
        chainRef,
        rpcEndpoints: rpcEndpoints.map((endpoint) =>
          rpcEndpointSchema.parse({
            url: endpoint.url,
            type: endpoint.type,
            weight: endpoint.weight,
            headers: endpoint.headers ? { ...endpoint.headers } : undefined,
          }),
        ),
        updatedAt: clock(),
      });

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

  const clear = async (chainRef: ChainRef): Promise<void> => {
    await run(async () => {
      const previous = parseRecord(await port.get(chainRef));
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
    getRpcEndpoints,
    set,
    clear,
  };
};
