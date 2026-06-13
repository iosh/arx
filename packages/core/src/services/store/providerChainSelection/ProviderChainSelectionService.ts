import { assertNamespace } from "../../../chains/caip.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { ProviderChainSelectionRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import { createSignal } from "../_shared/signal.js";
import { ProviderChainSelectionInvalidKeyError } from "./errors.js";
import type { ProviderChainSelectionPort } from "./port.js";
import type {
  ProviderChainSelectionChangedPayload,
  ProviderChainSelectionKey,
  ProviderChainSelectionService,
} from "./types.js";

export type CreateProviderChainSelectionServiceOptions = {
  port: ProviderChainSelectionPort;
  now?: () => number;
};

const parseOrigin = (origin: string): string => {
  if (origin.length === 0 || origin.trim() !== origin) {
    throw new ProviderChainSelectionInvalidKeyError({ field: "origin", value: origin });
  }
  return origin;
};

const parseNamespace = (namespace: string): string => {
  const namespaceKey = namespace.trim();
  if (namespaceKey.length === 0) {
    throw new ProviderChainSelectionInvalidKeyError({ field: "namespace", value: namespace });
  }
  return namespaceKey;
};

const cloneRecord = (record: ProviderChainSelectionRecord): ProviderChainSelectionRecord => ({
  origin: record.origin,
  namespace: record.namespace,
  chainRef: record.chainRef,
  updatedAt: record.updatedAt,
});

export const createProviderChainSelectionService = ({
  port,
  now,
}: CreateProviderChainSelectionServiceOptions): ProviderChainSelectionService => {
  const clock = now ?? Date.now;
  const changed = createSignal<ProviderChainSelectionChangedPayload>();
  const run = createSerialQueue();
  const cache = new Map<string, Map<string, ProviderChainSelectionRecord>>();

  const cacheRecord = (record: ProviderChainSelectionRecord) => {
    let recordsByNamespace = cache.get(record.origin);
    if (!recordsByNamespace) {
      recordsByNamespace = new Map();
      cache.set(record.origin, recordsByNamespace);
    }
    recordsByNamespace.set(record.namespace, cloneRecord(record));
  };

  const readCacheRecord = (origin: string, namespace: string): ProviderChainSelectionRecord | null => {
    const record = cache.get(origin)?.get(namespace) ?? null;
    return record ? cloneRecord(record) : null;
  };

  const deleteCacheRecord = (origin: string, namespace: string) => {
    const recordsByNamespace = cache.get(origin);
    if (!recordsByNamespace) {
      return;
    }

    recordsByNamespace.delete(namespace);
    if (recordsByNamespace.size === 0) {
      cache.delete(origin);
    }
  };

  const parseKey = (params: ProviderChainSelectionKey) => ({
    origin: parseOrigin(params.origin),
    namespace: parseNamespace(params.namespace),
  });

  const readCached = (params: ProviderChainSelectionKey): ProviderChainSelectionRecord | null => {
    const { origin, namespace } = parseKey(params);
    return readCacheRecord(origin, namespace);
  };

  const loadAll = async (): Promise<ProviderChainSelectionRecord[]> => {
    const records = await port.listAll();
    cache.clear();
    for (const record of records) {
      cacheRecord(record);
    }
    return records.map(cloneRecord);
  };

  const get = async (params: ProviderChainSelectionKey): Promise<ProviderChainSelectionRecord | null> => {
    const key = parseKey(params);
    const record = await port.get(key);
    if (!record) {
      deleteCacheRecord(key.origin, key.namespace);
      return null;
    }
    cacheRecord(record);
    return cloneRecord(record);
  };

  const getSelectedChainRef = (params: ProviderChainSelectionKey): ChainRef | null =>
    readCached(params)?.chainRef ?? null;

  const setSelectedChainRef = async (
    params: ProviderChainSelectionKey & { chainRef: ChainRef },
  ): Promise<ProviderChainSelectionRecord> => {
    return await run(async () => {
      const key = parseKey(params);
      assertNamespace(params.chainRef, key.namespace);
      const previous = await port.get(key);
      const next: ProviderChainSelectionRecord = {
        ...key,
        chainRef: params.chainRef,
        updatedAt: clock(),
      };

      if (previous?.chainRef === next.chainRef) {
        cacheRecord(previous);
        return cloneRecord(previous);
      }

      await port.upsert(next);
      cacheRecord(next);
      changed.emit({
        ...key,
        previous: previous ? cloneRecord(previous) : null,
        next: cloneRecord(next),
      });
      return cloneRecord(next);
    });
  };

  const clear = async (params: ProviderChainSelectionKey): Promise<void> => {
    await run(async () => {
      const key = parseKey(params);
      const previous = await port.get(key);
      deleteCacheRecord(key.origin, key.namespace);
      if (!previous) {
        return;
      }

      await port.remove(key);
      changed.emit({
        ...key,
        previous: cloneRecord(previous),
        next: null,
      });
    });
  };

  return {
    subscribeChanged: changed.subscribe,
    loadAll,
    get,
    getSnapshot: readCached,
    getSelectedChainRef,
    setSelectedChainRef,
    clear,
  };
};
