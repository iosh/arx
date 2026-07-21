import type { ChainRef } from "../networks/chainRef.js";
import { ChainNamespaceMismatchError, NetworkNotFoundError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { DappConnectionsBootstrap } from "./bootstrap.js";
import { DappOriginInvalidError } from "./errors.js";
import { parseDappOrigin } from "./origin.js";
import {
  type DappConnectionScope,
  type DappNetworkSelectionRecord,
  dappNetworkSelectionPersistenceType,
} from "./persistence.js";
import { dappConnectionScopeKey } from "./scope.js";

export type DappConnectionsUpdate = Readonly<{
  networkSelections: ReadonlyMap<string, DappNetworkSelectionRecord>;
  persistenceChanges: readonly PersistenceChange[];
}>;

export type DappConnectionsOptions = Readonly<{
  bootstrap: DappConnectionsBootstrap;
  networks: Pick<NetworksReader, "get">;
  mutations: CoreMutationQueue;
}>;

const compareSelections = (left: DappNetworkSelectionRecord, right: DappNetworkSelectionRecord): number =>
  left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace);

export class DappConnections {
  readonly #networks: Pick<NetworksReader, "get">;
  readonly #mutations: CoreMutationQueue;
  #networkSelections: ReadonlyMap<string, DappNetworkSelectionRecord>;

  constructor(options: DappConnectionsOptions) {
    this.#networks = options.networks;
    this.#mutations = options.mutations;

    const networkSelections = new Map<string, DappNetworkSelectionRecord>();

    for (const selection of options.bootstrap.networkSelections) {
      if (parseDappOrigin(selection.origin) !== selection.origin) {
        throw new DappOriginInvalidError(selection.origin);
      }

      this.#requireNetwork(selection);
      networkSelections.set(dappConnectionScopeKey(selection), selection);
    }

    this.#networkSelections = networkSelections;
  }

  getNetworkSelection(scope: DappConnectionScope): DappNetworkSelectionRecord | null {
    return this.#networkSelections.get(dappConnectionScopeKey(scope)) ?? null;
  }

  listNetworkSelections(): readonly DappNetworkSelectionRecord[] {
    return [...this.#networkSelections.values()].sort(compareSelections);
  }

  listNetworkSelectionsByOrigin(origin: string): readonly DappNetworkSelectionRecord[] {
    return this.listNetworkSelections().filter((selection) => selection.origin === origin);
  }

  listNetworkSelectionsByChainRef(chainRef: ChainRef): readonly DappNetworkSelectionRecord[] {
    return this.listNetworkSelections().filter((selection) => selection.chainRef === chainRef);
  }

  async selectNetwork(selection: DappNetworkSelectionRecord): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const update = this.prepareSelectNetwork(selection);
      if (!update) return;

      await commit(update.persistenceChanges);
      this.applyCommittedUpdate(update);
    });
  }

  prepareSelectNetwork(selection: DappNetworkSelectionRecord): DappConnectionsUpdate | null {
    const current = this.getNetworkSelection(selection);
    if (current?.chainRef === selection.chainRef) return null;

    this.#requireNetwork(selection);

    const networkSelections = new Map(this.#networkSelections);
    networkSelections.set(dappConnectionScopeKey(selection), selection);

    return {
      networkSelections,
      persistenceChanges: [persistenceChange.put(dappNetworkSelectionPersistenceType, selection)],
    };
  }

  prepareSelectNetworkIfMissing(selection: DappNetworkSelectionRecord): DappConnectionsUpdate | null {
    if (this.getNetworkSelection(selection)) return null;
    return this.prepareSelectNetwork(selection);
  }

  prepareRemoveOriginSelections(origin: string): DappConnectionsUpdate | null {
    const removed = this.listNetworkSelectionsByOrigin(origin);
    if (removed.length === 0) return null;

    const networkSelections = new Map(this.#networkSelections);
    for (const selection of removed) {
      networkSelections.delete(dappConnectionScopeKey(selection));
    }

    return {
      networkSelections,
      persistenceChanges: removed.map((selection) =>
        persistenceChange.remove(dappNetworkSelectionPersistenceType, selection),
      ),
    };
  }

  prepareReplaceNetworkSelections(
    input: Readonly<{
      chainRef: ChainRef;
      replacementChainRef: ChainRef;
    }>,
  ): DappConnectionsUpdate | null {
    const replaced = this.listNetworkSelectionsByChainRef(input.chainRef);
    if (replaced.length === 0) return null;

    const replacementNetwork = this.#networks.get(input.replacementChainRef);
    if (!replacementNetwork) {
      throw new NetworkNotFoundError(input.replacementChainRef);
    }

    const networkSelections = new Map(this.#networkSelections);
    const replacements = replaced.map((selection) => {
      if (replacementNetwork.namespace !== selection.namespace) {
        throw new ChainNamespaceMismatchError({
          chainRef: input.replacementChainRef,
          expectedNamespace: selection.namespace,
          actualNamespace: replacementNetwork.namespace,
        });
      }

      const replacement = {
        ...selection,
        chainRef: input.replacementChainRef,
      };
      networkSelections.set(dappConnectionScopeKey(replacement), replacement);
      return replacement;
    });

    return {
      networkSelections,
      persistenceChanges: replacements.map((selection) =>
        persistenceChange.put(dappNetworkSelectionPersistenceType, selection),
      ),
    };
  }

  prepareRemoveAllNetworkSelections(): DappConnectionsUpdate | null {
    const removed = this.listNetworkSelections();
    if (removed.length === 0) return null;

    return {
      networkSelections: new Map(),
      persistenceChanges: removed.map((selection) =>
        persistenceChange.remove(dappNetworkSelectionPersistenceType, selection),
      ),
    };
  }

  applyCommittedUpdate(update: DappConnectionsUpdate): void {
    this.#networkSelections = update.networkSelections;
  }

  #requireNetwork(selection: DappNetworkSelectionRecord): void {
    const network = this.#networks.get(selection.chainRef);
    if (!network) throw new NetworkNotFoundError(selection.chainRef);

    if (network.namespace !== selection.namespace) {
      throw new ChainNamespaceMismatchError({
        chainRef: selection.chainRef,
        expectedNamespace: selection.namespace,
        actualNamespace: network.namespace,
      });
    }
  }
}
