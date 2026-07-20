import type { Namespace } from "../namespaces/types.js";
import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { uniqueSortedStrings } from "../utils/array.js";
import type { NetworksBootstrap } from "./bootstrap.js";
import type { ChainRef } from "./chainRef.js";
import { parseChainRef } from "./chainRef.js";
import { isSameChainDefinition } from "./definition.js";
import {
  BuiltinNetworkConflictError,
  BuiltinNetworkImmutableError,
  ChainNamespaceMismatchError,
  CustomNetworkAlreadyExistsError,
  NetworkNamespaceUnsupportedError,
  NetworkNotFoundError,
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkSelectionMissingError,
} from "./errors.js";
import type { NetworksNamespaceAdapter, NetworksNamespaceAdapters } from "./namespaceAdapter.js";
import {
  customNetworkPersistenceType,
  type NetworkSelectionRecord,
  networkRpcOverridePersistenceType,
  networkSelectionPersistenceType,
} from "./persistence.js";
import type {
  CustomNetworkInput,
  Network,
  NetworkRpcConfiguration,
  NetworkRpcEndpointsReader,
  NetworkSelection,
  NetworkSelectionChanged,
  NetworksChanged,
  NetworksReader,
  NonEmptyRpcEndpoints,
} from "./types.js";

type InstalledNetwork = Readonly<{
  network: Network;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

type NetworksChange = NetworksChanged | NetworkSelectionChanged;

type NetworksUpdate = Readonly<{
  nextNetworks: ReadonlyMap<ChainRef, InstalledNetwork>;
  nextRpcOverrides: ReadonlyMap<ChainRef, NonEmptyRpcEndpoints>;
  nextSelection: NetworkSelection;
  persistenceChanges: readonly PersistenceChange[];
  change: NetworksChange;
}>;

type NetworksOptions = Readonly<{
  adapters: NetworksNamespaceAdapters;
  defaultNamespace: Namespace;
  bootstrap: NetworksBootstrap;
  mutations: CoreMutationQueue;
  /** Publishes committed network changes and must not throw. */
  publishChanged(change: NetworksChange): void;
}>;

const isSameRpcEndpoints = (left: NonEmptyRpcEndpoints, right: NonEmptyRpcEndpoints): boolean =>
  left.length === right.length && left.every((endpoint, index) => endpoint === right[index]);

const createInstalledCustomNetwork = (input: CustomNetworkInput, namespace: Namespace): InstalledNetwork => ({
  network: {
    ...input.definition,
    namespace,
    source: "custom",
  },
  defaultRpcEndpoints: input.defaultRpcEndpoints,
});

const selectionRecord = (selection: NetworkSelection): NetworkSelectionRecord => ({
  selectedNamespace: selection.selectedNamespace,
  selectedChainRefByNamespace: selection.selectedChainRefByNamespace,
});

/** Owns installed network state, wallet selection, RPC configuration, and standalone network mutations. */
export class Networks implements NetworksReader, NetworkRpcEndpointsReader {
  readonly #adapters: ReadonlyMap<Namespace, NetworksNamespaceAdapter>;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: NetworksOptions["publishChanged"];
  #networks: ReadonlyMap<ChainRef, InstalledNetwork>;
  #rpcOverrides: ReadonlyMap<ChainRef, NonEmptyRpcEndpoints>;
  #selection: NetworkSelection;

  constructor(options: NetworksOptions) {
    const adapters = new Map(options.adapters.map((adapter) => [adapter.namespace, adapter]));

    const networks = new Map<ChainRef, InstalledNetwork>();
    for (const adapter of options.adapters) {
      for (const seed of adapter.builtinNetworks) {
        networks.set(seed.definition.chainRef, {
          network: {
            ...seed.definition,
            namespace: adapter.namespace,
            source: "builtin",
          },
          defaultRpcEndpoints: seed.defaultRpcEndpoints,
        });
      }
    }

    for (const record of options.bootstrap.customNetworks) {
      const chainRef = record.definition.chainRef;
      const namespace = parseChainRef(chainRef).namespace;
      if (!adapters.has(namespace)) throw new NetworkNamespaceUnsupportedError(namespace);
      if (networks.get(chainRef)?.network.source === "builtin") throw new BuiltinNetworkConflictError(chainRef);

      networks.set(chainRef, createInstalledCustomNetwork(record, namespace));
    }

    const rpcOverrides = new Map<ChainRef, NonEmptyRpcEndpoints>();
    for (const record of options.bootstrap.networkRpcOverrides) {
      if (!networks.has(record.chainRef)) throw new NetworkNotFoundError(record.chainRef);
      rpcOverrides.set(record.chainRef, record.endpoints);
    }

    const storedSelection =
      options.bootstrap.selection ??
      ({
        selectedNamespace: options.defaultNamespace,
        selectedChainRefByNamespace: Object.fromEntries(
          options.adapters.map((adapter) => [adapter.namespace, adapter.defaultChainRef]),
        ),
      } satisfies NetworkSelectionRecord);

    this.#adapters = adapters;
    this.#mutations = options.mutations;
    this.#publishChanged = options.publishChanged;
    this.#networks = networks;
    this.#rpcOverrides = rpcOverrides;
    this.#selection = this.createSelection(storedSelection);
  }

  get(chainRef: ChainRef): Network | null {
    const installed = this.#networks.get(chainRef);
    return installed?.network ?? null;
  }

  list(): readonly Network[] {
    return [...this.#networks.values()]
      .map((installed) => installed.network)
      .sort((left, right) => {
        if (left.source !== right.source) return left.source === "builtin" ? -1 : 1;
        return left.chainRef.localeCompare(right.chainRef);
      });
  }

  listByNamespace(namespace: Namespace): readonly Network[] {
    this.requireAdapter(namespace);
    return this.list().filter((network) => network.namespace === namespace);
  }

  getSelection(): NetworkSelection {
    return this.#selection;
  }

  getRpcConfiguration(chainRef: ChainRef): NetworkRpcConfiguration {
    const installed = this.requireInstalledNetwork(chainRef);

    const override = this.#rpcOverrides.get(chainRef);
    if (override) {
      return {
        source: "override",
        endpoints: override,
        defaultEndpoints: installed.defaultRpcEndpoints,
      };
    }

    return {
      source: "default",
      endpoints: installed.defaultRpcEndpoints,
    };
  }

  getRpcEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints {
    return this.getRpcConfiguration(chainRef).endpoints;
  }

  async addCustom(input: CustomNetworkInput): Promise<void> {
    const chainRef = input.definition.chainRef;
    const namespace = parseChainRef(chainRef).namespace;
    this.assertCustomNetworkCanBeAdded(chainRef);

    await this.admitRpcEndpoints(chainRef, namespace, input.defaultRpcEndpoints);
    await this.commitUpdate(() => this.prepareAddCustom(input, namespace));
  }

  async updateCustom(input: CustomNetworkInput): Promise<void> {
    const chainRef = input.definition.chainRef;
    const current = this.requireCustomNetwork(chainRef);

    if (!isSameRpcEndpoints(current.defaultRpcEndpoints, input.defaultRpcEndpoints)) {
      await this.admitRpcEndpoints(chainRef, current.network.namespace, input.defaultRpcEndpoints);
    }

    await this.commitUpdate(() => this.prepareUpdateCustom(input));
  }

  async setRpcOverride(input: { chainRef: ChainRef; endpoints: NonEmptyRpcEndpoints }): Promise<void> {
    const installed = this.requireInstalledNetwork(input.chainRef);
    const current = this.#rpcOverrides.get(input.chainRef);

    if (!current || !isSameRpcEndpoints(current, input.endpoints)) {
      await this.admitRpcEndpoints(input.chainRef, installed.network.namespace, input.endpoints);
    }

    await this.commitUpdate(() => this.prepareSetRpcOverride(input));
  }

  clearRpcOverride(chainRef: ChainRef): Promise<void> {
    return this.commitUpdate(() => this.prepareClearRpcOverride(chainRef));
  }

  selectNetwork(chainRef: ChainRef): Promise<void> {
    return this.commitUpdate(() => this.prepareSelectNetwork(chainRef));
  }

  selectNamespace(namespace: Namespace): Promise<void> {
    this.requireAdapter(namespace);
    return this.commitUpdate(() => this.prepareSelectNamespace(namespace));
  }

  private prepareAddCustom(input: CustomNetworkInput, namespace: Namespace): NetworksUpdate {
    const chainRef = input.definition.chainRef;
    this.assertCustomNetworkCanBeAdded(chainRef);

    const nextNetworks = new Map(this.#networks);
    nextNetworks.set(chainRef, createInstalledCustomNetwork(input, namespace));

    return {
      nextNetworks,
      nextRpcOverrides: this.#rpcOverrides,
      nextSelection: this.#selection,
      persistenceChanges: [persistenceChange.put(customNetworkPersistenceType, input)],
      change: { type: "networksChanged", chainRefs: [chainRef] },
    };
  }

  private prepareUpdateCustom(input: CustomNetworkInput): NetworksUpdate | null {
    const chainRef = input.definition.chainRef;
    const current = this.requireCustomNetwork(chainRef);
    if (
      isSameChainDefinition(current.network, input.definition) &&
      isSameRpcEndpoints(current.defaultRpcEndpoints, input.defaultRpcEndpoints)
    ) {
      return null;
    }

    const nextNetworks = new Map(this.#networks);
    nextNetworks.set(chainRef, createInstalledCustomNetwork(input, current.network.namespace));

    return {
      nextNetworks,
      nextRpcOverrides: this.#rpcOverrides,
      nextSelection: this.#selection,
      persistenceChanges: [persistenceChange.put(customNetworkPersistenceType, input)],
      change: { type: "networksChanged", chainRefs: [chainRef] },
    };
  }

  private prepareSetRpcOverride(input: { chainRef: ChainRef; endpoints: NonEmptyRpcEndpoints }): NetworksUpdate | null {
    this.requireInstalledNetwork(input.chainRef);
    const current = this.#rpcOverrides.get(input.chainRef);
    if (current && isSameRpcEndpoints(current, input.endpoints)) return null;

    const nextRpcOverrides = new Map(this.#rpcOverrides);
    nextRpcOverrides.set(input.chainRef, input.endpoints);

    return {
      nextNetworks: this.#networks,
      nextRpcOverrides,
      nextSelection: this.#selection,
      persistenceChanges: [
        persistenceChange.put(networkRpcOverridePersistenceType, {
          chainRef: input.chainRef,
          endpoints: input.endpoints,
        }),
      ],
      change: { type: "networksChanged", chainRefs: [input.chainRef] },
    };
  }

  private prepareClearRpcOverride(chainRef: ChainRef): NetworksUpdate | null {
    this.requireInstalledNetwork(chainRef);
    if (!this.#rpcOverrides.has(chainRef)) return null;

    const nextRpcOverrides = new Map(this.#rpcOverrides);
    nextRpcOverrides.delete(chainRef);

    return {
      nextNetworks: this.#networks,
      nextRpcOverrides,
      nextSelection: this.#selection,
      persistenceChanges: [persistenceChange.remove(networkRpcOverridePersistenceType, chainRef)],
      change: { type: "networksChanged", chainRefs: [chainRef] },
    };
  }

  private prepareSelectNetwork(chainRef: ChainRef): NetworksUpdate | null {
    const installed = this.requireInstalledNetwork(chainRef);
    const namespace = installed.network.namespace;
    const currentChainRef = this.#selection.selectedChainRefByNamespace[namespace];
    if (this.#selection.selectedNamespace === namespace && currentChainRef === chainRef) return null;

    const selectedChainRefByNamespace =
      currentChainRef === chainRef
        ? this.#selection.selectedChainRefByNamespace
        : { ...this.#selection.selectedChainRefByNamespace, [namespace]: chainRef };
    const nextSelection: NetworkSelection = {
      selectedNamespace: namespace,
      selectedChainRef: chainRef,
      selectedChainRefByNamespace,
    };

    return {
      nextNetworks: this.#networks,
      nextRpcOverrides: this.#rpcOverrides,
      nextSelection,
      persistenceChanges: [persistenceChange.put(networkSelectionPersistenceType, selectionRecord(nextSelection))],
      change: {
        type: "networkSelectionChanged",
        namespaces: uniqueSortedStrings([this.#selection.selectedNamespace, namespace]),
      },
    };
  }

  private prepareSelectNamespace(namespace: Namespace): NetworksUpdate | null {
    if (this.#selection.selectedNamespace === namespace) return null;

    const selectedChainRef = this.#selection.selectedChainRefByNamespace[namespace] as ChainRef;
    const nextSelection: NetworkSelection = {
      selectedNamespace: namespace,
      selectedChainRef,
      selectedChainRefByNamespace: this.#selection.selectedChainRefByNamespace,
    };

    return {
      nextNetworks: this.#networks,
      nextRpcOverrides: this.#rpcOverrides,
      nextSelection,
      persistenceChanges: [persistenceChange.put(networkSelectionPersistenceType, selectionRecord(nextSelection))],
      change: {
        type: "networkSelectionChanged",
        namespaces: uniqueSortedStrings([this.#selection.selectedNamespace, namespace]),
      },
    };
  }

  private async admitRpcEndpoints(
    chainRef: ChainRef,
    namespace: Namespace,
    endpoints: NonEmptyRpcEndpoints,
  ): Promise<void> {
    const adapter = this.requireAdapter(namespace);

    for (const endpoint of endpoints) {
      if (!URL.canParse(endpoint)) throw new NetworkRpcEndpointInvalidError(endpoint);
      const protocol = new URL(endpoint).protocol;
      if (protocol !== "http:" && protocol !== "https:") throw new NetworkRpcEndpointInvalidError(endpoint);
    }

    for (const endpoint of endpoints) {
      const actualChainRef = await adapter.queryChainRef(endpoint);
      if (actualChainRef !== chainRef) {
        throw new NetworkRpcEndpointMismatchError({
          endpoint,
          expectedChainRef: chainRef,
          actualChainRef,
        });
      }
    }
  }

  private async commitUpdate(prepare: () => NetworksUpdate | null): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const update = prepare();
      if (!update) return;

      await commit(update.persistenceChanges);

      this.#networks = update.nextNetworks;
      this.#rpcOverrides = update.nextRpcOverrides;
      this.#selection = update.nextSelection;

      this.#publishChanged(update.change);
    });
  }

  private requireAdapter(namespace: Namespace): NetworksNamespaceAdapter {
    const adapter = this.#adapters.get(namespace);
    if (!adapter) throw new NetworkNamespaceUnsupportedError(namespace);
    return adapter;
  }

  private requireInstalledNetwork(chainRef: ChainRef): InstalledNetwork {
    const installed = this.#networks.get(chainRef);
    if (!installed) throw new NetworkNotFoundError(chainRef);
    return installed;
  }

  private requireCustomNetwork(chainRef: ChainRef): InstalledNetwork {
    const installed = this.requireInstalledNetwork(chainRef);
    if (installed.network.source === "builtin") throw new BuiltinNetworkImmutableError(chainRef);
    return installed;
  }

  private assertCustomNetworkCanBeAdded(chainRef: ChainRef): void {
    const installed = this.#networks.get(chainRef);
    if (installed?.network.source === "builtin") throw new BuiltinNetworkConflictError(chainRef);
    if (installed) throw new CustomNetworkAlreadyExistsError(chainRef);
  }

  private createSelection(record: NetworkSelectionRecord): NetworkSelection {
    if (!this.#adapters.has(record.selectedNamespace)) {
      throw new NetworkNamespaceUnsupportedError(record.selectedNamespace);
    }
    for (const namespace of Object.keys(record.selectedChainRefByNamespace)) {
      if (!this.#adapters.has(namespace)) throw new NetworkNamespaceUnsupportedError(namespace);
    }
    for (const namespace of this.#adapters.keys()) {
      const chainRef = record.selectedChainRefByNamespace[namespace];
      if (!chainRef) throw new NetworkSelectionMissingError(namespace);

      const installed = this.#networks.get(chainRef);
      if (!installed) throw new NetworkNotFoundError(chainRef);
      const actualNamespace = installed.network.namespace;
      if (actualNamespace !== namespace) {
        throw new ChainNamespaceMismatchError({
          chainRef,
          expectedNamespace: namespace,
          actualNamespace,
        });
      }
    }

    const selectedChainRef = record.selectedChainRefByNamespace[record.selectedNamespace];
    if (!selectedChainRef) throw new NetworkSelectionMissingError(record.selectedNamespace);

    return {
      selectedNamespace: record.selectedNamespace,
      selectedChainRef,
      selectedChainRefByNamespace: record.selectedChainRefByNamespace,
    };
  }
}
