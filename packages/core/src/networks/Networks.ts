import type { Namespace } from "../namespaces/types.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { NetworksBootstrap } from "./bootstrap.js";
import type { ChainRef } from "./chainRef.js";
import { parseChainRef } from "./chainRef.js";
import { isSameChainDefinition } from "./definition.js";
import {
  BuiltinNetworkConflictError,
  BuiltinNetworkImmutableError,
  CustomNetworkAlreadyExistsError,
  NetworkNamespaceUnsupportedError,
  NetworkNotFoundError,
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkRpcEndpointReadError,
} from "./errors.js";
import type { NetworksNamespaceAdapter, NetworksNamespaceAdapters } from "./namespaceAdapter.js";
import { customNetworkWrites, networkRpcOverrideWrites } from "./persistence.js";
import type {
  CustomNetworkInput,
  Network,
  NetworkRpcConfiguration,
  NetworkRpcEndpointsReader,
  NetworksChanged,
  NetworksReader,
  NonEmptyRpcEndpoints,
} from "./types.js";

type InstalledNetwork = Readonly<{
  network: Network;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

type NetworksUpdate = Readonly<{
  nextNetworks: ReadonlyMap<ChainRef, InstalledNetwork>;
  nextRpcOverrides: ReadonlyMap<ChainRef, NonEmptyRpcEndpoints>;
  persistenceChanges: readonly PersistenceChange[];
  change: NetworksChanged;
}>;

export type CustomNetworkRemovalPlan = Readonly<{
  persistenceChanges: readonly PersistenceChange[];
  activate(): void;
  publish(): void;
}>;

type NetworksOptions = Readonly<{
  adapters: NetworksNamespaceAdapters;
  bootstrap: NetworksBootstrap;
  mutations: CoreMutationQueue;
  /** Publishes committed network changes and must not throw. */
  publishChanged(change: NetworksChanged): void;
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

/** Owns installed network state, RPC configuration, and standalone network mutations. */
export class Networks implements NetworksReader, NetworkRpcEndpointsReader {
  readonly #adapters: ReadonlyMap<Namespace, NetworksNamespaceAdapter>;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: NetworksOptions["publishChanged"];
  #networks: ReadonlyMap<ChainRef, InstalledNetwork>;
  #rpcOverrides: ReadonlyMap<ChainRef, NonEmptyRpcEndpoints>;

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
      networks.set(chainRef, createInstalledCustomNetwork(record, namespace));
    }

    const rpcOverrides = new Map<ChainRef, NonEmptyRpcEndpoints>();
    for (const record of options.bootstrap.networkRpcOverrides) {
      rpcOverrides.set(record.chainRef, record.endpoints);
    }

    this.#adapters = adapters;
    this.#mutations = options.mutations;
    this.#publishChanged = options.publishChanged;
    this.#networks = networks;
    this.#rpcOverrides = rpcOverrides;
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

    await this.validateRpcConfiguration(chainRef, input.defaultRpcEndpoints);
    await this.commitUpdate(() => this.prepareAddCustom(input, namespace));
  }

  async updateCustom(input: CustomNetworkInput): Promise<void> {
    const chainRef = input.definition.chainRef;
    const current = this.requireCustomNetwork(chainRef);

    if (!isSameRpcEndpoints(current.defaultRpcEndpoints, input.defaultRpcEndpoints)) {
      await this.validateRpcConfiguration(chainRef, input.defaultRpcEndpoints);
    }

    await this.commitUpdate(() => this.prepareUpdateCustom(input));
  }

  async setRpcOverride(input: { chainRef: ChainRef; endpoints: NonEmptyRpcEndpoints }): Promise<void> {
    this.requireInstalledNetwork(input.chainRef);
    const current = this.#rpcOverrides.get(input.chainRef);

    if (!current || !isSameRpcEndpoints(current, input.endpoints)) {
      await this.validateRpcConfiguration(input.chainRef, input.endpoints);
    }

    await this.commitUpdate(() => this.prepareSetRpcOverride(input));
  }

  clearRpcOverride(chainRef: ChainRef): Promise<void> {
    return this.commitUpdate(() => this.prepareClearRpcOverride(chainRef));
  }

  private prepareAddCustom(input: CustomNetworkInput, namespace: Namespace): NetworksUpdate {
    const chainRef = input.definition.chainRef;
    this.assertCustomNetworkCanBeAdded(chainRef);

    const nextNetworks = new Map(this.#networks);
    nextNetworks.set(chainRef, createInstalledCustomNetwork(input, namespace));

    return {
      nextNetworks,
      nextRpcOverrides: this.#rpcOverrides,
      persistenceChanges: [customNetworkWrites.put(input)],
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
      persistenceChanges: [customNetworkWrites.put(input)],
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
      persistenceChanges: [
        networkRpcOverrideWrites.put({
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
      persistenceChanges: [networkRpcOverrideWrites.remove(chainRef)],
      change: { type: "networksChanged", chainRefs: [chainRef] },
    };
  }

  prepareRemoveCustom(chainRef: ChainRef): CustomNetworkRemovalPlan {
    this.requireCustomNetwork(chainRef);

    const nextNetworks = new Map(this.#networks);
    nextNetworks.delete(chainRef);

    const nextRpcOverrides = new Map(this.#rpcOverrides);
    const hadRpcOverride = nextRpcOverrides.delete(chainRef);

    const persistenceChanges: PersistenceChange[] = [customNetworkWrites.remove(chainRef)];
    if (hadRpcOverride) persistenceChanges.push(networkRpcOverrideWrites.remove(chainRef));
    const update: NetworksUpdate = {
      nextNetworks,
      nextRpcOverrides,
      persistenceChanges,
      change: { type: "networksChanged", chainRefs: [chainRef] },
    };

    return {
      persistenceChanges,
      activate: () => this.#applyCommittedUpdate(update),
      publish: () => this.#publishCommittedUpdate(update),
    };
  }

  #applyCommittedUpdate(update: NetworksUpdate): void {
    this.#networks = update.nextNetworks;
    this.#rpcOverrides = update.nextRpcOverrides;
  }

  #publishCommittedUpdate(update: NetworksUpdate): void {
    this.#publishChanged(update.change);
  }

  private async validateRpcConfiguration(expectedChainRef: ChainRef, endpoints: NonEmptyRpcEndpoints): Promise<void> {
    for (const endpoint of endpoints) {
      if (!URL.canParse(endpoint)) throw new NetworkRpcEndpointInvalidError(endpoint);
      const protocol = new URL(endpoint).protocol;
      if (protocol !== "http:" && protocol !== "https:") throw new NetworkRpcEndpointInvalidError(endpoint);
    }

    const adapter = this.requireAdapter(parseChainRef(expectedChainRef).namespace);

    await Promise.all(
      endpoints.map(async (endpoint) => {
        let reportedChainRef: ChainRef;
        try {
          reportedChainRef = await adapter.queryChainRef(endpoint);
        } catch (cause) {
          throw new NetworkRpcEndpointReadError({ endpoint, cause });
        }
        if (reportedChainRef !== expectedChainRef) {
          throw new NetworkRpcEndpointMismatchError({
            endpoint,
            expectedChainRef,
            actualChainRef: reportedChainRef,
          });
        }
      }),
    );
  }

  private async commitUpdate(prepare: () => NetworksUpdate | null): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const update = prepare();
      if (!update) return;

      await commit(update.persistenceChanges);

      this.#applyCommittedUpdate(update);
      this.#publishCommittedUpdate(update);
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
}
