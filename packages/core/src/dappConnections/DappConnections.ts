import type { Accounts } from "../accounts/Accounts.js";
import type { Namespace } from "../namespaces/types.js";
import { type ChainRef, splitChainRef } from "../networks/chainRef.js";
import { ChainNamespaceMismatchError, NetworkNotFoundError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import type { PermissionsReader } from "../permissions/Permissions.js";
import { type DappScope, dappScopeKey } from "../permissions/scope.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { commitUpdates, type PreparedUpdate } from "../persistence/preparedUpdate.js";
import type { WalletStatusReader } from "../wallet/Wallet.js";
import type { DappConnectionsBootstrap } from "./bootstrap.js";
import { type DappNetworkSelectionRecord, dappNetworkSelectionWrites } from "./persistence.js";

export type DappConnectionState = Readonly<{
  chainRef: ChainRef;
  accounts: readonly string[];
}>;

export type DappConnectionStateChanged = Readonly<{
  scope: DappScope;
  state: DappConnectionState;
  changedFields: Readonly<{
    chainRef: boolean;
    accounts: boolean;
  }>;
}>;

export type DappConnectionsOptions = Readonly<{
  bootstrap: DappConnectionsBootstrap;
  /** Defaults must be builtin networks so deleting a custom network always has a fallback. */
  defaultChainRefs: Readonly<Record<Namespace, ChainRef>>;
  accounts: Pick<Accounts, "getAddress">;
  networks: Pick<NetworksReader, "get">;
  permissions: PermissionsReader;
  wallet: WalletStatusReader;
  mutations: CoreMutationQueue;
  publishStateChanged(change: DappConnectionStateChanged): void;
}>;

type ActiveConnection = Readonly<{
  scope: DappScope;
  state: DappConnectionState;
}>;

const compareSelections = (left: DappNetworkSelectionRecord, right: DappNetworkSelectionRecord): number =>
  left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace);

const accountsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((account, index) => account === right[index]);

const compareStateChanges = (left: DappConnectionStateChanged, right: DappConnectionStateChanged): number =>
  left.scope.origin.localeCompare(right.scope.origin) || left.scope.namespace.localeCompare(right.scope.namespace);

/** Owns persisted dapp network selections and the transient state of open dapp connections. */
export class DappConnections {
  readonly #defaultChainRefs: DappConnectionsOptions["defaultChainRefs"];
  readonly #accounts: Pick<Accounts, "getAddress">;
  readonly #networks: Pick<NetworksReader, "get">;
  readonly #permissions: PermissionsReader;
  readonly #wallet: WalletStatusReader;
  readonly #mutations: CoreMutationQueue;
  readonly #publishStateChanged: DappConnectionsOptions["publishStateChanged"];
  #networkSelections: ReadonlyMap<string, DappNetworkSelectionRecord>;
  #activeConnections = new Map<string, ActiveConnection>();

  constructor(options: DappConnectionsOptions) {
    this.#defaultChainRefs = options.defaultChainRefs;
    this.#accounts = options.accounts;
    this.#networks = options.networks;
    this.#permissions = options.permissions;
    this.#wallet = options.wallet;
    this.#mutations = options.mutations;
    this.#publishStateChanged = options.publishStateChanged;

    this.#networkSelections = new Map(
      options.bootstrap.networkSelections.map((selection) => [dappScopeKey(selection), selection]),
    );
  }

  getNetworkSelection(scope: DappScope): DappNetworkSelectionRecord | null {
    return this.#networkSelections.get(dappScopeKey(scope)) ?? null;
  }

  listNetworkSelections(): readonly DappNetworkSelectionRecord[] {
    return [...this.#networkSelections.values()].sort(compareSelections);
  }

  listNetworkSelectionsByChainRef(chainRef: ChainRef): readonly DappNetworkSelectionRecord[] {
    return this.listNetworkSelections().filter((selection) => selection.chainRef === chainRef);
  }

  openConnection(scope: DappScope): DappConnectionState {
    const key = dappScopeKey(scope);
    const active = this.#activeConnections.get(key);
    if (active) return this.#createConnectionState(scope, active.state.chainRef);

    const state = this.getConnectionState(scope);
    this.#activeConnections.set(key, { scope, state });
    return state;
  }

  getConnectionState(scope: DappScope): DappConnectionState {
    const active = this.#activeConnections.get(dappScopeKey(scope));
    if (active) return this.#createConnectionState(scope, active.state.chainRef);

    return this.#createConnectionState(
      scope,
      this.getNetworkSelection(scope)?.chainRef ?? this.#defaultChainRefs[scope.namespace],
    );
  }

  isConnectionOpen(scope: DappScope): boolean {
    return this.#activeConnections.has(dappScopeKey(scope));
  }

  closeConnection(scope: DappScope): void {
    this.#activeConnections.delete(dappScopeKey(scope));
  }

  /** Complete commands call this after changing accounts, permissions, or the wallet session. */
  refreshAccountsForOpenConnections(): void {
    const changes: DappConnectionStateChanged[] = [];

    for (const active of this.#activeConnections.values()) {
      const change = this.#replaceOpenConnectionState(active.scope, active.state.chainRef);
      if (change) changes.push(change);
    }

    this.#publishStateChanges(changes);
  }

  async selectNetwork(selection: DappNetworkSelectionRecord): Promise<void> {
    await this.#mutations.run((commit) => commitUpdates(commit, [this.prepareSelectNetwork(selection)]));
  }

  prepareSelectNetwork(selection: DappNetworkSelectionRecord): PreparedUpdate | null {
    const current = this.getNetworkSelection(selection);
    if (current?.chainRef === selection.chainRef) return null;

    this.#requireNetwork(selection);

    const networkSelections = new Map(this.#networkSelections);
    networkSelections.set(dappScopeKey(selection), selection);
    let stateChanges: readonly DappConnectionStateChanged[] = [];

    return {
      persistenceChanges: [dappNetworkSelectionWrites.put(selection)],
      activate: () => {
        this.#networkSelections = networkSelections;
        const change = this.#replaceOpenConnectionState(selection, selection.chainRef);
        stateChanges = change ? [change] : [];
      },
      publish: () => this.#publishStateChanges(stateChanges),
    };
  }

  prepareRemoveNetworkReferences(chainRef: ChainRef): PreparedUpdate {
    const replacementChainRef = this.#defaultChainRefs[splitChainRef(chainRef).namespace];
    const removedSelections = this.listNetworkSelectionsByChainRef(chainRef);
    const removedSelectionScopeKeys = new Set(removedSelections.map(dappScopeKey));
    const remainingSelections = new Map(this.#networkSelections);
    for (const selection of removedSelections) {
      remainingSelections.delete(dappScopeKey(selection));
    }
    let stateChanges: readonly DappConnectionStateChanged[] = [];

    return {
      persistenceChanges: removedSelections.map(dappNetworkSelectionWrites.remove),
      activate: () => {
        this.#networkSelections = remainingSelections;
        const changes: DappConnectionStateChanged[] = [];

        // Connections can open while the network command is committing, even without persisted site selections.
        for (const [key, active] of this.#activeConnections) {
          if (active.state.chainRef !== chainRef && !removedSelectionScopeKeys.has(key)) continue;

          const change = this.#replaceOpenConnectionState(
            active.scope,
            remainingSelections.get(key)?.chainRef ?? replacementChainRef,
          );
          if (change) changes.push(change);
        }

        stateChanges = changes;
      },
      publish: () => this.#publishStateChanges(stateChanges),
    };
  }

  #replaceOpenConnectionState(scope: DappScope, chainRef: ChainRef): DappConnectionStateChanged | null {
    const key = dappScopeKey(scope);
    const active = this.#activeConnections.get(key);
    if (!active) return null;

    const state = this.#createConnectionState(active.scope, chainRef);
    const changedFields = {
      chainRef: active.state.chainRef !== state.chainRef,
      accounts: !accountsEqual(active.state.accounts, state.accounts),
    };
    if (!changedFields.chainRef && !changedFields.accounts) return null;

    this.#activeConnections.set(key, {
      scope: active.scope,
      state,
    });

    return { scope: active.scope, state, changedFields };
  }

  #publishStateChanges(changes: readonly DappConnectionStateChanged[]): void {
    for (const change of [...changes].sort(compareStateChanges)) this.#publishStateChanged(change);
  }

  #createConnectionState(scope: DappScope, chainRef: ChainRef): DappConnectionState {
    const permission = this.#permissions.get(scope);
    const accounts =
      this.#wallet.getStatus() === "unlocked" && permission
        ? permission.accountIds.map((accountId) => this.#accounts.getAddress({ accountId, chainRef }).canonicalAddress)
        : [];

    return { chainRef, accounts };
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
