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
  networkSelections: ReadonlyMap<string, DappNetworkSelectionRecord>;
  persistenceChanges: readonly PersistenceChange[];
  /** Scopes whose persisted Dapp network selection changed. */
  changedScopes: readonly DappConnectionScope[];
}>;

export type DappConnectionState = Readonly<{
  chainRef: ChainRef;
  accounts: readonly string[];
}>;

export type DappConnectionStateChanged = Readonly<{
  scope: DappConnectionScope;
  state: DappConnectionState;
  changedFields: Readonly<{
    chainRef: boolean;
    accounts: boolean;
  }>;
}>;

export type DappConnectionsOptions = Readonly<{
  bootstrap: DappConnectionsBootstrap;
  accounts: Pick<Accounts, "getAddress">;
  networks: Pick<NetworksReader, "get" | "getSelection">;
  permissions: PermissionsReader;
  wallet: Pick<Wallet, "getStatus">;
  mutations: CoreMutationQueue;
  /** Publishes a derived active-connection state change and must not throw. */
  publishConnectionStateChanged(change: DappConnectionStateChanged): void;
}>;

type ActiveConnection = Readonly<{
  scope: DappConnectionScope;
  state: DappConnectionState;
}>;

const compareSelections = (left: DappNetworkSelectionRecord, right: DappNetworkSelectionRecord): number =>
  left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace);

const compareScopes = (left: DappConnectionScope, right: DappConnectionScope): number =>
  left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace);

const accountListsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((account, index) => account === right[index]);

const networkSelectionScope = (selection: DappNetworkSelectionRecord): DappConnectionScope => ({
  origin: selection.origin,
  namespace: selection.namespace,
});

export class DappConnections {
  readonly #accounts: Pick<Accounts, "getAddress">;
  readonly #networks: Pick<NetworksReader, "get" | "getSelection">;
  readonly #permissions: PermissionsReader;
  readonly #wallet: Pick<Wallet, "getStatus">;
  readonly #mutations: CoreMutationQueue;
  readonly #publishConnectionStateChanged: DappConnectionsOptions["publishConnectionStateChanged"];
  #networkSelections: ReadonlyMap<string, DappNetworkSelectionRecord>;
  #activeConnections = new Map<string, ActiveConnection>();

  constructor(options: DappConnectionsOptions) {
    this.#accounts = options.accounts;
    this.#networks = options.networks;
    this.#permissions = options.permissions;
    this.#wallet = options.wallet;
    this.#mutations = options.mutations;
    this.#publishConnectionStateChanged = options.publishConnectionStateChanged;

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

  refreshActiveConnectionStates(selectionChangedScopes: readonly DappConnectionScope[] = []): void {
    const changedSelectionScopeKeys = new Set(selectionChangedScopes.map(dappConnectionScopeKey));
    const pendingStateChanges: DappConnectionStateChanged[] = [];
    const activeConnections = [...this.#activeConnections.values()].sort((left, right) =>
      compareScopes(left.scope, right.scope),
    );

    for (const active of activeConnections) {
      const key = dappConnectionScopeKey(active.scope);
      const chainRef = changedSelectionScopeKeys.has(key)
        ? this.#getCurrentConnectionChainRef(active.scope)
        : active.state.chainRef;
      const state = this.#createConnectionState(active.scope, chainRef);
      const changedFields = {
        chainRef: active.state.chainRef !== state.chainRef,
        accounts: !accountListsEqual(active.state.accounts, state.accounts),
      };

      this.#activeConnections.set(key, { scope: active.scope, state });
      if (!changedFields.chainRef && !changedFields.accounts) continue;

      pendingStateChanges.push({
        scope: active.scope,
        state,
        changedFields,
      });
    }

    for (const change of pendingStateChanges) this.#publishConnectionStateChanged(change);
  }

  async selectNetwork(selection: DappNetworkSelectionRecord): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const update = this.prepareSelectNetwork(selection);
      if (!update) return;

      await commit(update.persistenceChanges);
      this.applyCommittedUpdate(update);
      this.refreshActiveConnectionStates(update.changedScopes);
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
      changedScopes: [networkSelectionScope(selection)],
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
      changedScopes: removed.map(networkSelectionScope),
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
      changedScopes: replaced.map(networkSelectionScope),
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
      changedScopes: removed.map(networkSelectionScope),
    };
  }

  applyCommittedUpdate(update: DappConnectionsUpdate): void {
    this.#networkSelections = update.networkSelections;
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

    return this.#getWalletSelectedChainRef(scope);
  }

  #getWalletSelectedChainRef(scope: DappConnectionScope): ChainRef {
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
