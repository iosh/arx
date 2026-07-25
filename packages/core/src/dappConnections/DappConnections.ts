import type { Accounts } from "../accounts/Accounts.js";
import type { ChainRef } from "../networks/chainRef.js";
import {
  ChainNamespaceMismatchError,
  NetworkNamespaceUnsupportedError,
  NetworkNotFoundError,
} from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import type { PermissionsReader } from "../permissions/Permissions.js";
import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { Wallet } from "../wallet/Wallet.js";
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
  persistenceChanges: readonly PersistenceChange[];
  activate(): void;
}>;

export type DappConnectionState = Readonly<{
  chainRef: ChainRef;
  accounts: readonly string[];
}>;

export type DappConnectionsOptions = Readonly<{
  bootstrap: DappConnectionsBootstrap;
  accounts: Pick<Accounts, "getAddress">;
  networks: Pick<NetworksReader, "get" | "getSelection">;
  permissions: PermissionsReader;
  wallet: Pick<Wallet, "getStatus">;
  mutations: CoreMutationQueue;
}>;

type ActiveConnection = Readonly<{
  scope: DappConnectionScope;
  state: DappConnectionState;
}>;

const compareSelections = (left: DappNetworkSelectionRecord, right: DappNetworkSelectionRecord): number =>
  left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace);

const networkSelectionScope = (selection: DappNetworkSelectionRecord): DappConnectionScope => ({
  origin: selection.origin,
  namespace: selection.namespace,
});

/** Owns persisted dapp network selections and the transient state of open dapp connections. */
export class DappConnections {
  readonly #accounts: Pick<Accounts, "getAddress">;
  readonly #networks: Pick<NetworksReader, "get" | "getSelection">;
  readonly #permissions: PermissionsReader;
  readonly #wallet: Pick<Wallet, "getStatus">;
  readonly #mutations: CoreMutationQueue;
  #networkSelections: ReadonlyMap<string, DappNetworkSelectionRecord>;
  #activeConnections = new Map<string, ActiveConnection>();

  constructor(options: DappConnectionsOptions) {
    this.#accounts = options.accounts;
    this.#networks = options.networks;
    this.#permissions = options.permissions;
    this.#wallet = options.wallet;
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

  openConnection(scope: DappConnectionScope): DappConnectionState {
    const key = dappConnectionScopeKey(scope);
    const active = this.#activeConnections.get(key);
    if (active) return active.state;

    const state = this.#createConnectionState(scope, this.#getCurrentConnectionChainRef(scope));
    this.#activeConnections.set(key, { scope, state });
    return state;
  }

  getConnectionState(scope: DappConnectionScope): DappConnectionState {
    const active = this.#activeConnections.get(dappConnectionScopeKey(scope));
    if (active) return active.state;

    return this.#createConnectionState(scope, this.#getCurrentConnectionChainRef(scope));
  }

  isConnectionOpen(scope: DappConnectionScope): boolean {
    return this.#activeConnections.has(dappConnectionScopeKey(scope));
  }

  closeConnection(scope: DappConnectionScope): void {
    this.#activeConnections.delete(dappConnectionScopeKey(scope));
  }

  refreshAccountsForOpenConnections(): void {
    for (const [key, active] of this.#activeConnections) {
      const state = this.#createConnectionState(active.scope, active.state.chainRef);
      this.#activeConnections.set(key, { scope: active.scope, state });
    }
  }

  async selectNetwork(selection: DappNetworkSelectionRecord): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const update = this.prepareSelectNetwork(selection);
      if (!update) return;

      await commit(update.persistenceChanges);
      update.activate();
    });
  }

  prepareSelectNetwork(selection: DappNetworkSelectionRecord): DappConnectionsUpdate | null {
    const current = this.getNetworkSelection(selection);
    if (current?.chainRef === selection.chainRef) return null;

    this.#requireNetwork(selection);

    const networkSelections = new Map(this.#networkSelections);
    networkSelections.set(dappConnectionScopeKey(selection), selection);

    return {
      persistenceChanges: [persistenceChange.put(dappNetworkSelectionPersistenceType, selection)],
      activate: () => {
        this.#networkSelections = networkSelections;
        this.#moveOpenConnectionsToCurrentNetwork([networkSelectionScope(selection)]);
      },
    };
  }

  prepareRemoveOriginSelections(origin: string): DappConnectionsUpdate | null {
    const removedSelections = this.listNetworkSelectionsByOrigin(origin);
    if (removedSelections.length === 0) return null;

    const remainingSelections = new Map(this.#networkSelections);
    for (const selection of removedSelections) {
      remainingSelections.delete(dappConnectionScopeKey(selection));
    }

    return {
      persistenceChanges: removedSelections.map((selection) =>
        persistenceChange.remove(dappNetworkSelectionPersistenceType, selection),
      ),
      activate: () => {
        this.#networkSelections = remainingSelections;
        this.#moveOpenConnectionsToCurrentNetwork(removedSelections.map(networkSelectionScope));
      },
    };
  }

  prepareRemoveNetworkReferences(chainRef: ChainRef): DappConnectionsUpdate {
    const removedSelections = this.listNetworkSelectionsByChainRef(chainRef);
    const removedSelectionScopeKeys = new Set(removedSelections.map(dappConnectionScopeKey));
    const remainingSelections = new Map(this.#networkSelections);
    for (const selection of removedSelections) {
      remainingSelections.delete(dappConnectionScopeKey(selection));
    }

    return {
      persistenceChanges: removedSelections.map((selection) =>
        persistenceChange.remove(dappNetworkSelectionPersistenceType, selection),
      ),
      activate: () => {
        this.#networkSelections = remainingSelections;

        for (const [key, active] of this.#activeConnections) {
          if (active.state.chainRef !== chainRef && !removedSelectionScopeKeys.has(key)) continue;
          this.#replaceOpenConnectionState(active.scope, this.#getCurrentConnectionChainRef(active.scope));
        }
      },
    };
  }

  #moveOpenConnectionsToCurrentNetwork(scopes: readonly DappConnectionScope[]): void {
    for (const scope of scopes) {
      if (!this.isConnectionOpen(scope)) continue;
      this.#replaceOpenConnectionState(scope, this.#getCurrentConnectionChainRef(scope));
    }
  }

  #replaceOpenConnectionState(scope: DappConnectionScope, chainRef: ChainRef): void {
    const key = dappConnectionScopeKey(scope);
    this.#activeConnections.set(key, {
      scope,
      state: this.#createConnectionState(scope, chainRef),
    });
  }

  #createConnectionState(scope: DappConnectionScope, chainRef: ChainRef): DappConnectionState {
    const permission = this.#permissions.get(scope);
    const accounts =
      this.#wallet.getStatus() === "unlocked" && permission
        ? permission.accountIds.map((accountId) => this.#accounts.getAddress({ accountId, chainRef }).canonicalAddress)
        : [];

    return { chainRef, accounts };
  }

  #getCurrentConnectionChainRef(scope: DappConnectionScope): ChainRef {
    const selection = this.getNetworkSelection(scope);
    if (selection) return selection.chainRef;

    const chainRef = this.#networks.getSelection().selectedChainRefByNamespace[scope.namespace];
    if (!chainRef) throw new NetworkNamespaceUnsupportedError(scope.namespace);
    return chainRef;
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
