import { type ChainRef, parseChainRef } from "../networks/chainRef.js";
import {
  ChainNamespaceMismatchError,
  NetworkNamespaceUnsupportedError,
  NetworkNotFoundError,
} from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import { persistenceChange } from "../persistence/change.js";
import type { OriginNamespaceKey } from "../persistence/keys.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { ProviderChainSelectionInvalidKeyError } from "./errors.js";
import {
  type ProviderChainSelectionRecord,
  type ProviderChainSelectionsReader,
  providerChainSelectionPersistenceType,
} from "./persistence.js";

export type ProviderChainSelections = Readonly<{
  get(key: OriginNamespaceKey): Promise<ProviderChainSelectionRecord | null>;
  initialize(key: OriginNamespaceKey): Promise<ProviderChainSelectionRecord>;
  select(input: OriginNamespaceKey & { chainRef: ChainRef }): Promise<void>;
  clear(key: OriginNamespaceKey): Promise<void>;
  clearOrigin(origin: string): Promise<void>;
}>;

const readKey = (key: OriginNamespaceKey): OriginNamespaceKey => {
  if (!key.origin || key.origin.trim() !== key.origin) {
    throw new ProviderChainSelectionInvalidKeyError({ field: "origin", value: key.origin });
  }
  if (!key.namespace || key.namespace.trim() !== key.namespace) {
    throw new ProviderChainSelectionInvalidKeyError({ field: "namespace", value: key.namespace });
  }
  return key;
};

export const createProviderChainSelections = (params: {
  reader: ProviderChainSelectionsReader;
  mutations: CoreMutationQueue;
  networks: Pick<NetworksReader, "get" | "getSelection">;
}): ProviderChainSelections => {
  const requireAvailableChain = (chainRef: ChainRef): void => {
    if (!params.networks.get(chainRef)) throw new NetworkNotFoundError(chainRef);
  };

  return {
    get: async (input) => await params.reader.get(readKey(input)),
    initialize: async (input) => {
      const key = readKey(input);
      return await params.mutations.run(async (commit) => {
        const current = await params.reader.get(key);
        if (current) return current;
        const chainRef = params.networks.getSelection().selectedChainRefByNamespace[key.namespace];
        if (!chainRef) throw new NetworkNamespaceUnsupportedError(key.namespace);
        requireAvailableChain(chainRef);
        const next: ProviderChainSelectionRecord = { ...key, chainRef };
        await commit([persistenceChange.put(providerChainSelectionPersistenceType, next)]);
        return next;
      });
    },
    select: async (input) => {
      const key = readKey(input);
      const { namespace } = parseChainRef(input.chainRef);
      if (namespace !== key.namespace) {
        throw new ChainNamespaceMismatchError({
          chainRef: input.chainRef,
          expectedNamespace: key.namespace,
          actualNamespace: namespace,
        });
      }
      await params.mutations.run(async (commit) => {
        requireAvailableChain(input.chainRef);
        const current = await params.reader.get(key);
        if (current?.chainRef === input.chainRef) return;
        await commit([
          persistenceChange.put(providerChainSelectionPersistenceType, { ...key, chainRef: input.chainRef }),
        ]);
      });
    },
    clear: async (input) => {
      const key = readKey(input);
      await params.mutations.run(async (commit) => {
        if (!(await params.reader.get(key))) return;
        await commit([persistenceChange.remove(providerChainSelectionPersistenceType, key)]);
      });
    },
    clearOrigin: async (origin) => {
      const keyOrigin = origin.trim();
      if (!keyOrigin || keyOrigin !== origin) {
        throw new ProviderChainSelectionInvalidKeyError({ field: "origin", value: origin });
      }
      await params.mutations.run(async (commit) => {
        const records = await params.reader.listByOrigin(keyOrigin);
        await commit(
          records.map(({ origin: recordOrigin, namespace }) =>
            persistenceChange.remove(providerChainSelectionPersistenceType, { origin: recordOrigin, namespace }),
          ),
        );
      });
    },
  };
};
