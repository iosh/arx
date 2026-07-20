import type { Namespace } from "../namespaces/types.js";
import type { NetworksBootstrap } from "./bootstrap.js";
import type { ChainRef } from "./chainRef.js";
import { parseChainRef } from "./chainRef.js";
import {
  BuiltinNetworkConflictError,
  ChainNamespaceMismatchError,
  NetworkNamespaceUnsupportedError,
  NetworkNotFoundError,
  NetworkSelectionMissingError,
} from "./errors.js";
import type { NetworksNamespaceAdapters } from "./namespaceAdapter.js";
import type { NetworkSelectionRecord } from "./persistence.js";
import type {
  Network,
  NetworkRpcConfiguration,
  NetworkRpcEndpointsReader,
  NetworkSelection,
  NetworksReader,
  NonEmptyRpcEndpoints,
} from "./types.js";

type InstalledNetwork = Readonly<{
  network: Network;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

type NetworksOptions = Readonly<{
  adapters: NetworksNamespaceAdapters;
  defaultNamespace: Namespace;
  bootstrap: NetworksBootstrap;
}>;

/** Owns installed network state, wallet selection, and RPC configuration. */
export class Networks implements NetworksReader, NetworkRpcEndpointsReader {
  readonly #namespaces: ReadonlySet<Namespace>;
  readonly #networks: ReadonlyMap<ChainRef, InstalledNetwork>;
  readonly #rpcOverrides: ReadonlyMap<ChainRef, NonEmptyRpcEndpoints>;
  readonly #selection: NetworkSelection;

  constructor(options: NetworksOptions) {
    const namespaces = new Set(options.adapters.map((adapter) => adapter.namespace));

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
      if (!namespaces.has(namespace)) throw new NetworkNamespaceUnsupportedError(namespace);
      if (networks.get(chainRef)?.network.source === "builtin") throw new BuiltinNetworkConflictError(chainRef);

      networks.set(chainRef, {
        network: {
          ...record.definition,
          namespace,
          source: "custom",
        },
        defaultRpcEndpoints: record.defaultRpcEndpoints,
      });
    }

    const rpcOverrides = new Map<ChainRef, NonEmptyRpcEndpoints>();
    for (const record of options.bootstrap.networkRpcOverrides) {
      if (!networks.has(record.chainRef)) throw new NetworkNotFoundError(record.chainRef);
      rpcOverrides.set(record.chainRef, record.endpoints);
    }

    const selectionRecord =
      options.bootstrap.selection ??
      ({
        selectedNamespace: options.defaultNamespace,
        selectedChainRefByNamespace: Object.fromEntries(
          options.adapters.map((adapter) => [adapter.namespace, adapter.defaultChainRef]),
        ),
      } satisfies NetworkSelectionRecord);

    this.#namespaces = namespaces;
    this.#networks = networks;
    this.#rpcOverrides = rpcOverrides;
    this.#selection = this.createSelection(selectionRecord);
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
    if (!this.#namespaces.has(namespace)) throw new NetworkNamespaceUnsupportedError(namespace);
    return this.list().filter((network) => network.namespace === namespace);
  }

  getSelection(): NetworkSelection {
    return this.#selection;
  }

  getRpcConfiguration(chainRef: ChainRef): NetworkRpcConfiguration {
    const installed = this.#networks.get(chainRef);
    if (!installed) throw new NetworkNotFoundError(chainRef);

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

  private createSelection(record: NetworkSelectionRecord): NetworkSelection {
    if (!this.#namespaces.has(record.selectedNamespace)) {
      throw new NetworkNamespaceUnsupportedError(record.selectedNamespace);
    }
    for (const namespace of Object.keys(record.selectedChainRefByNamespace)) {
      if (!this.#namespaces.has(namespace)) throw new NetworkNamespaceUnsupportedError(namespace);
    }
    for (const namespace of this.#namespaces) {
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
