import type { Namespace } from "../namespaces/types.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { commitUpdates, type PreparedUpdate } from "../persistence/preparedUpdate.js";
import type { NetworksBootstrap } from "./bootstrap.js";
import type { ChainRef } from "./chainRef.js";
import { parseChainRef, splitChainRef } from "./chainRef.js";
import { cloneChainDefinition, isSameChainDefinition } from "./definition.js";
import {
  BuiltinNetworkConflictError,
  BuiltinNetworkImmutableError,
  CustomNetworkAlreadyExistsError,
  NetworkBlockExplorerExistsError,
  NetworkConfigurationChangedError,
  NetworkNotFoundError,
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkRpcEndpointReadError,
  NetworkRpcEndpointRequiredError,
} from "./errors.js";
import type { NetworksNamespaceAdapters } from "./namespaceAdapter.js";
import { customNetworkWrites, networkRpcOverrideWrites } from "./persistence.js";
import type {
  CustomNetworkInput,
  CustomNetworkUpdate,
  Network,
  NetworkRpcConfiguration,
  NetworkRpcEndpointsReader,
  NetworksChanged,
  NetworksReader,
  NetworkUrlUpdate,
  NonEmptyRpcEndpoints,
} from "./types.js";

type InstalledNetwork = Readonly<{
  network: Network;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
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
  readonly #adapters: NetworksNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: NetworksOptions["publishChanged"];
  #networks: ReadonlyMap<ChainRef, InstalledNetwork>;
  #rpcOverrides: ReadonlyMap<ChainRef, NonEmptyRpcEndpoints>;

  constructor(options: NetworksOptions) {
    const networks = new Map<ChainRef, InstalledNetwork>();
    for (const adapter of Object.values(options.adapters)) {
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

    this.#adapters = options.adapters;
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
    await this.commitUpdate(() => ({ update: this.prepareAddCustom(input, namespace), result: undefined }));
  }

  updateCustom({ chainRef, changes }: CustomNetworkUpdate): Promise<Network> {
    return this.commitUpdate(() => {
      const current = this.requireCustomNetwork(chainRef);
      return this.prepareUpdateCustom({
        definition: {
          ...cloneChainDefinition(current.network),
          ...changes,
          nativeCurrency: { ...current.network.nativeCurrency, ...changes.nativeCurrency },
        },
        defaultRpcEndpoints: current.defaultRpcEndpoints,
      });
    });
  }

  updateBlockExplorers({ chainRef, update }: { chainRef: ChainRef; update: NetworkUrlUpdate }): Promise<Network> {
    return this.commitUpdate(() => {
      const current = this.requireCustomNetwork(chainRef);
      const explorers = [...(current.network.blockExplorers ?? [])];
      if (update.type !== "add" && explorers[update.index]?.url !== update.expectedUrl) {
        throw new NetworkConfigurationChangedError(chainRef);
      }
      if (update.type === "replace" && update.url === update.expectedUrl) {
        return { update: null, result: current.network };
      }
      if (update.type !== "remove" && explorers.some(({ url }) => url === update.url)) {
        throw new NetworkBlockExplorerExistsError({ chainRef, url: update.url });
      }
      if (update.type === "add") explorers.push({ url: update.url });
      else if (update.type === "replace") explorers[update.index] = { url: update.url };
      else explorers.splice(update.index, 1);

      return this.prepareUpdateCustom({
        definition: { ...cloneChainDefinition(current.network), blockExplorers: explorers },
        defaultRpcEndpoints: current.defaultRpcEndpoints,
      });
    });
  }

  async updateRpcEndpoints({
    chainRef,
    update,
  }: {
    chainRef: ChainRef;
    update: NetworkUrlUpdate;
  }): Promise<NetworkRpcConfiguration> {
    this.requireInstalledNetwork(chainRef);
    if (update.type === "add" || (update.type === "replace" && update.url !== update.expectedUrl)) {
      await this.validateRpcConfiguration(chainRef, [update.url]);
    }

    return this.commitUpdate(() => {
      const current = this.getRpcConfiguration(chainRef);
      const endpoints: [string, ...string[]] = [...current.endpoints];
      if (update.type !== "add" && endpoints[update.index] !== update.expectedUrl) {
        throw new NetworkConfigurationChangedError(chainRef);
      }
      if (update.type === "add") endpoints.push(update.url);
      else if (update.type === "replace") endpoints[update.index] = update.url;
      else {
        if (endpoints.length === 1) throw new NetworkRpcEndpointRequiredError(chainRef);
        endpoints.splice(update.index, 1);
      }
      if (isSameRpcEndpoints(current.endpoints, endpoints)) return { update: null, result: current };
      return this.prepareSetRpcOverride({ chainRef, endpoints });
    });
  }

  clearRpcOverride(chainRef: ChainRef): Promise<NetworkRpcConfiguration> {
    return this.commitUpdate(() => this.prepareClearRpcOverride(chainRef));
  }

  private prepareAddCustom(input: CustomNetworkInput, namespace: Namespace): PreparedUpdate {
    const chainRef = input.definition.chainRef;
    this.assertCustomNetworkCanBeAdded(chainRef);

    const nextNetworks = new Map(this.#networks);
    nextNetworks.set(chainRef, createInstalledCustomNetwork(input, namespace));

    return this.prepareUpdate(nextNetworks, this.#rpcOverrides, [customNetworkWrites.put(input)], chainRef);
  }

  private prepareUpdateCustom(input: CustomNetworkInput): Readonly<{ update: PreparedUpdate | null; result: Network }> {
    const chainRef = input.definition.chainRef;
    const current = this.requireCustomNetwork(chainRef);
    if (
      isSameChainDefinition(current.network, input.definition) &&
      isSameRpcEndpoints(current.defaultRpcEndpoints, input.defaultRpcEndpoints)
    ) {
      return { update: null, result: current.network };
    }

    const nextNetworks = new Map(this.#networks);
    const installed = createInstalledCustomNetwork(input, current.network.namespace);
    nextNetworks.set(chainRef, installed);

    return {
      update: this.prepareUpdate(nextNetworks, this.#rpcOverrides, [customNetworkWrites.put(input)], chainRef),
      result: installed.network,
    };
  }

  private prepareSetRpcOverride(input: { chainRef: ChainRef; endpoints: NonEmptyRpcEndpoints }): Readonly<{
    update: PreparedUpdate | null;
    result: NetworkRpcConfiguration;
  }> {
    const installed = this.requireInstalledNetwork(input.chainRef);
    const current = this.#rpcOverrides.get(input.chainRef);
    if (current && isSameRpcEndpoints(current, input.endpoints)) {
      return { update: null, result: this.getRpcConfiguration(input.chainRef) };
    }

    const nextRpcOverrides = new Map(this.#rpcOverrides);
    nextRpcOverrides.set(input.chainRef, input.endpoints);

    return {
      update: this.prepareUpdate(
        this.#networks,
        nextRpcOverrides,
        [
          networkRpcOverrideWrites.put({
            chainRef: input.chainRef,
            endpoints: input.endpoints,
          }),
        ],
        input.chainRef,
      ),
      result: { source: "override", endpoints: input.endpoints, defaultEndpoints: installed.defaultRpcEndpoints },
    };
  }

  private prepareClearRpcOverride(chainRef: ChainRef): Readonly<{
    update: PreparedUpdate | null;
    result: NetworkRpcConfiguration;
  }> {
    const installed = this.requireInstalledNetwork(chainRef);
    const result: NetworkRpcConfiguration = { source: "default", endpoints: installed.defaultRpcEndpoints };
    if (!this.#rpcOverrides.has(chainRef)) return { update: null, result };

    const nextRpcOverrides = new Map(this.#rpcOverrides);
    nextRpcOverrides.delete(chainRef);

    return {
      update: this.prepareUpdate(
        this.#networks,
        nextRpcOverrides,
        [networkRpcOverrideWrites.remove(chainRef)],
        chainRef,
      ),
      result,
    };
  }

  /** The complete command checks pending transactions and commits dapp reference cleanup with this removal. */
  prepareRemoveCustom(chainRef: ChainRef): PreparedUpdate {
    this.requireCustomNetwork(chainRef);

    const nextNetworks = new Map(this.#networks);
    nextNetworks.delete(chainRef);

    const nextRpcOverrides = new Map(this.#rpcOverrides);
    const hadRpcOverride = nextRpcOverrides.delete(chainRef);

    const persistenceChanges: PersistenceChange[] = [customNetworkWrites.remove(chainRef)];
    if (hadRpcOverride) persistenceChanges.push(networkRpcOverrideWrites.remove(chainRef));
    return this.prepareUpdate(nextNetworks, nextRpcOverrides, persistenceChanges, chainRef);
  }

  private prepareUpdate(
    nextNetworks: ReadonlyMap<ChainRef, InstalledNetwork>,
    nextRpcOverrides: ReadonlyMap<ChainRef, NonEmptyRpcEndpoints>,
    persistenceChanges: readonly PersistenceChange[],
    chainRef: ChainRef,
  ): PreparedUpdate {
    const change: NetworksChanged = { type: "networksChanged", chainRefs: [chainRef] };
    return {
      persistenceChanges,
      activate: () => {
        this.#networks = nextNetworks;
        this.#rpcOverrides = nextRpcOverrides;
      },
      publish: () => this.#publishChanged(change),
    };
  }

  private async validateRpcConfiguration(expectedChainRef: ChainRef, endpoints: NonEmptyRpcEndpoints): Promise<void> {
    for (const endpoint of endpoints) {
      if (!URL.canParse(endpoint)) throw new NetworkRpcEndpointInvalidError(endpoint);
      const protocol = new URL(endpoint).protocol;
      if (protocol !== "http:" && protocol !== "https:") throw new NetworkRpcEndpointInvalidError(endpoint);
    }

    const adapter = this.#adapters[splitChainRef(expectedChainRef).namespace];

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

  private commitUpdate<TResult>(
    prepare: () => Readonly<{ update: PreparedUpdate | null; result: TResult }>,
  ): Promise<TResult> {
    return this.#mutations.run(async (commit) => {
      const { update, result } = prepare();
      await commitUpdates(commit, [update]);
      return result;
    });
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
