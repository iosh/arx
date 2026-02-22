import { toAccountIdFromAddress, toCanonicalAddressFromAccountId } from "../../accounts/accountId.js";
import { parseChainRef as parseCaipChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainDescriptorRegistry, createDefaultChainDescriptorRegistry } from "../../chains/registry.js";
import type { PermissionsService } from "../../services/permissions/types.js";
import type { PermissionRecord } from "../../storage/records.js";
import type { ChainNamespace } from "../account/types.js";
import {
  type GrantPermissionOptions,
  type NamespacePermissionState,
  type OriginPermissionState,
  type OriginPermissions,
  type PermissionController,
  type PermissionGrant,
  type PermissionMessenger,
  type PermissionScope,
  type PermissionScopeResolver,
  PermissionScopes,
  type PermissionsState,
} from "./types.js";

const PERMISSION_STATE_TOPIC = "permission:stateChanged";
const PERMISSION_ORIGIN_TOPIC = "permission:originChanged";

const DEFAULT_PERMISSION_NAMESPACE: ChainNamespace = "eip155";

const PERMISSION_SCOPE_ORDER: readonly PermissionScope[] = [
  PermissionScopes.Basic,
  PermissionScopes.Accounts,
  PermissionScopes.Sign,
  PermissionScopes.Transaction,
];

const PERMISSION_SCOPE_ORDER_INDEX = new Map(PERMISSION_SCOPE_ORDER.map((scope, index) => [scope, index] as const));

const sortScopes = (scopes: readonly PermissionScope[]): PermissionScope[] => {
  return [...scopes].sort(
    (a, b) => (PERMISSION_SCOPE_ORDER_INDEX.get(a) ?? 999) - (PERMISSION_SCOPE_ORDER_INDEX.get(b) ?? 999),
  );
};

const sortChains = <T extends string>(chains: readonly T[]): T[] => {
  return [...chains].sort((a, b) => a.localeCompare(b));
};

const cloneState = (state: PermissionsState): PermissionsState => ({
  origins: Object.fromEntries(
    Object.entries(state.origins).map(([origin, originState]) => [
      origin,
      Object.fromEntries(
        Object.entries(originState).map(([namespace, namespaceState]) => [
          namespace,
          {
            chains: Object.fromEntries(
              Object.entries(namespaceState.chains).map(([chainRef, chainState]) => [
                chainRef,
                {
                  scopes: [...chainState.scopes],
                  ...(chainState.accounts ? { accounts: [...chainState.accounts] } : {}),
                },
              ]),
            ),
          } satisfies NamespacePermissionState,
        ]),
      ) as OriginPermissionState,
    ]),
  ),
});

type OriginHashMap = Map<string, string>;

const hashOriginRecords = (records: PermissionRecord[]): string => {
  // Use a stable JSON representation to avoid delimiter-collision footguns.
  const stable = records
    .map((record) => {
      const grants = [...record.grants]
        .map((g) => ({
          scope: String(g.scope),
          chains: uniqSorted((g.chains as ChainRef[]).map((c) => String(c) as ChainRef)),
        }))
        .sort((a, b) => a.scope.localeCompare(b.scope));

      const accountIds = (record.accountIds ?? []).map(String).sort((a, b) => a.localeCompare(b));

      return {
        namespace: String(record.namespace),
        grants,
        accountIds,
      };
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace));

  return JSON.stringify(stable);
};

type ParsedPermissionChainRef = {
  namespace: ChainNamespace;
  value: ChainRef;
};

const tryParseChainRef = (chainRef: string | null | undefined): ParsedPermissionChainRef | null => {
  if (!chainRef || typeof chainRef !== "string") return null;
  try {
    const parsed = parseCaipChainRef(chainRef as ChainRef);
    return {
      namespace: parsed.namespace as ChainNamespace,
      value: `${parsed.namespace}:${parsed.reference}` as ChainRef,
    };
  } catch {
    return null;
  }
};

const deriveNamespaceFromContext = (context?: Parameters<PermissionScopeResolver>[1]): ChainNamespace => {
  if (context?.namespace) return context.namespace as ChainNamespace;
  const parsed = tryParseChainRef(context?.chainRef ?? null);
  return parsed?.namespace ?? DEFAULT_PERMISSION_NAMESPACE;
};

const deriveNamespaceFromOptions = (options: {
  namespace?: ChainNamespace | null;
  chainRef: ChainRef;
}): { namespace: ChainNamespace; chainRef: ChainRef } => {
  const parsed = tryParseChainRef(options.chainRef);
  const namespace = (options.namespace ?? parsed?.namespace ?? DEFAULT_PERMISSION_NAMESPACE) as ChainNamespace;
  const normalized = parsed?.value ?? options.chainRef;

  if (options.namespace && parsed && parsed.namespace !== options.namespace) {
    throw new Error(
      `Permission namespace mismatch: chainRef "${parsed.value}" belongs to namespace "${parsed.namespace}" but "${options.namespace}" was provided`,
    );
  }

  return { namespace, chainRef: normalized };
};

const uniqSorted = <T extends string>(values: readonly T[]): T[] => {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
};

const upsertGrantChains = (
  grants: PermissionRecord["grants"],
  params: { scope: PermissionScope; chainRef: ChainRef },
): PermissionRecord["grants"] => {
  const next: PermissionRecord["grants"] = [];
  let updated = false;

  for (const grant of grants) {
    if (grant.scope !== params.scope) {
      next.push(grant);
      continue;
    }
    updated = true;
    const chains = uniqSorted([...(grant.chains as ChainRef[]), params.chainRef]);
    next.push({ ...grant, chains });
  }

  if (!updated) {
    next.push({ scope: params.scope, chains: [params.chainRef] } as PermissionRecord["grants"][number]);
  }

  // Keep deterministic order for stable snapshots/tests.
  next.sort((a, b) => String(a.scope).localeCompare(String(b.scope)));
  return next;
};

const buildOriginStateFromRecords = (records: PermissionRecord[]): OriginPermissionState => {
  const byNamespace = new Map<string, PermissionRecord>();
  for (const record of records) {
    // One record per (origin, namespace). If store is dirty, last write wins.
    byNamespace.set(record.namespace, record);
  }

  const originState: OriginPermissionState = {};

  for (const record of byNamespace.values()) {
    const namespace = record.namespace as ChainNamespace;

    const chainMap = new Map<
      ChainRef,
      {
        scopes: Set<PermissionScope>;
        accounts?: string[];
      }
    >();

    for (const grant of record.grants) {
      const scope = grant.scope as PermissionScope;
      for (const chainRef of grant.chains as ChainRef[]) {
        const entry = chainMap.get(chainRef) ?? { scopes: new Set<PermissionScope>() };
        entry.scopes.add(scope);
        chainMap.set(chainRef, entry);
      }
    }

    // EIP-155 only: attach accounts ONLY to chains that have the Accounts scope caveat.
    if (namespace === "eip155" && record.accountIds?.length) {
      const accountsGrant = record.grants.find((g) => g.scope === PermissionScopes.Accounts);
      const permittedChains = (accountsGrant?.chains ?? []) as ChainRef[];

      for (const chainRef of permittedChains) {
        const accounts = record.accountIds.map((accountId) => toCanonicalAddressFromAccountId({ chainRef, accountId }));
        const entry = chainMap.get(chainRef) ?? { scopes: new Set<PermissionScope>() };
        entry.scopes.add(PermissionScopes.Accounts);
        entry.accounts = [...accounts];
        chainMap.set(chainRef, entry);
      }
    }

    const chains: NamespacePermissionState["chains"] = {};
    for (const chainRef of sortChains([...chainMap.keys()])) {
      const entry = chainMap.get(chainRef);
      if (!entry) continue;
      chains[chainRef] = {
        scopes: sortScopes([...entry.scopes]),
        ...(entry.accounts ? { accounts: [...entry.accounts] } : {}),
      };
    }

    originState[namespace] = { chains };
  }

  return originState;
};

const buildStateFromRecords = (records: PermissionRecord[]): PermissionsState => {
  const origins = new Map<string, PermissionRecord[]>();
  for (const record of records) {
    const list = origins.get(record.origin) ?? [];
    list.push(record);
    origins.set(record.origin, list);
  }

  const state: PermissionsState = { origins: {} };
  for (const [origin, originRecords] of origins.entries()) {
    state.origins[origin] = buildOriginStateFromRecords(originRecords);
  }
  return state;
};

export type StorePermissionControllerOptions = {
  messenger: PermissionMessenger;
  scopeResolver: PermissionScopeResolver;
  service: PermissionsService;
  chains?: ChainDescriptorRegistry;
};

/**
 * Store-backed permissions controller:
 * - Single source of truth: PermissionsService (backed by the `permissions` table)
 * - In-memory state is a derived view for UI snapshot / sync reads.
 */
export class StorePermissionController implements PermissionController {
  #messenger: PermissionMessenger;
  #scopeResolver: PermissionScopeResolver;
  #service: PermissionsService;
  #chains: ChainDescriptorRegistry;

  #state: PermissionsState = { origins: {} };
  #originHash: OriginHashMap = new Map();

  #ready: Promise<void>;
  #syncPromise: Promise<void> | null = null;
  #pendingFullSync = false;
  #pendingOrigins: Set<string> = new Set();

  constructor({ messenger, scopeResolver, service, chains }: StorePermissionControllerOptions) {
    this.#messenger = messenger;
    this.#scopeResolver = scopeResolver;
    this.#service = service;
    this.#chains = chains ?? createDefaultChainDescriptorRegistry();

    this.#service.on("changed", (event) => {
      void this.#queueSyncFromStore({ origin: event?.origin ?? null }).catch(() => {});
    });

    // lifecycle.initialize() awaits whenReady(); keep constructor side-effects best-effort.
    this.#ready = this.#queueSyncFromStore();
    this.#publishState();
  }

  whenReady(): Promise<void> {
    return this.#ready;
  }

  listGrants(origin: string): PermissionGrant[] {
    const originState = this.#state.origins[origin];
    if (!originState) return [];

    const grants: PermissionGrant[] = [];

    for (const [namespace, namespaceState] of Object.entries(originState)) {
      for (const [chainRef, chainState] of Object.entries(namespaceState.chains)) {
        grants.push({
          origin,
          namespace: namespace as ChainNamespace,
          chainRef: chainRef as ChainRef,
          scopes: [...chainState.scopes],
          ...(chainState.accounts?.length ? { accounts: [...chainState.accounts] } : {}),
        });
      }
    }

    grants.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.chainRef.localeCompare(b.chainRef));
    return grants;
  }

  getState(): PermissionsState {
    return cloneState(this.#state);
  }

  listConnectedOrigins(options: { namespace: ChainNamespace }): string[] {
    const namespace = options.namespace;
    const connected: string[] = [];

    for (const [origin, originState] of Object.entries(this.#state.origins)) {
      const nsState = originState[namespace];
      if (!nsState) continue;
      const anyConnected = Object.values(nsState.chains).some((chain) => {
        if (!chain.scopes.includes(PermissionScopes.Accounts)) return false;
        if (namespace === "eip155") {
          // Treat missing accounts as not-connected to avoid spreading dirty state.
          return (chain.accounts?.length ?? 0) > 0;
        }
        return true;
      });
      if (anyConnected) connected.push(origin);
    }

    connected.sort((a, b) => a.localeCompare(b));
    return connected;
  }

  getPermittedAccounts(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): string[] {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);
    if (namespace !== "eip155") return [];

    const chainState = this.#state.origins[origin]?.[namespace]?.chains?.[chainRef];
    if (!chainState) return [];
    if (!chainState.scopes.includes(PermissionScopes.Accounts)) return [];
    return [...(chainState.accounts ?? [])];
  }

  isConnected(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): boolean {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);
    const chainState = this.#state.origins[origin]?.[namespace]?.chains?.[chainRef];
    return !!chainState?.scopes.includes(PermissionScopes.Accounts);
  }

  async setPermittedAccounts(
    origin: string,
    options: { namespace?: ChainNamespace | null; chainRef: ChainRef; accounts: string[] },
  ): Promise<void> {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);

    if (namespace !== "eip155") {
      throw new Error(`setPermittedAccounts is only supported for namespace "eip155" (got "${namespace}")`);
    }

    const seen = new Set<string>();
    const uniqueAccounts: string[] = [];
    for (const raw of options.accounts) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const canonical = this.#chains.toCanonicalAddress({ chainRef, value: trimmed }).canonical;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      uniqueAccounts.push(canonical);
    }

    if (uniqueAccounts.length === 0) {
      throw new Error("setPermittedAccounts requires at least one account");
    }

    const accountIds = uniqueAccounts.map((address) => toAccountIdFromAddress({ chainRef, address }));

    const existing = await this.#service.getByOrigin({ origin, namespace });
    const nextGrants = upsertGrantChains(existing?.grants ?? [], { scope: PermissionScopes.Accounts, chainRef });

    await this.#service.upsert({
      ...(existing?.id ? { id: existing.id } : {}),
      origin,
      namespace,
      grants: nextGrants,
      accountIds,
    });

    await this.#queueSyncFromStore();
  }

  async assertPermission(
    origin: string,
    method: string,
    context?: Parameters<PermissionScopeResolver>[1],
  ): Promise<void> {
    const scope = this.#scopeResolver(method, context);
    if (!scope) return;

    const namespace = deriveNamespaceFromContext(context);
    const parsedChain = tryParseChainRef(context?.chainRef ?? null);
    const nsState = this.#state.origins[origin]?.[namespace];
    if (!nsState) {
      throw new Error(`Origin "${origin}" lacks scope "${scope}" for namespace "${namespace}"`);
    }

    if (parsedChain) {
      const chainRef = parsedChain.value;
      const chainState = nsState.chains?.[chainRef];
      if (!chainState || !chainState.scopes.includes(scope)) {
        throw new Error(`Origin "${origin}" lacks scope "${scope}" for ${namespace} on chain "${chainRef}"`);
      }
      return;
    }

    // Fallback for contexts without an explicit chainRef.
    const any = Object.values(nsState.chains).some((chain) => chain.scopes.includes(scope));
    if (!any) {
      throw new Error(`Origin "${origin}" lacks scope "${scope}" for namespace "${namespace}"`);
    }
  }

  async grant(origin: string, scope: PermissionScope, options?: GrantPermissionOptions): Promise<void> {
    const chainRef = options?.chainRef ?? null;
    if (!chainRef) throw new Error("StorePermissionController.grant requires a chainRef");
    const { namespace, chainRef: normalized } = deriveNamespaceFromOptions({
      namespace: options?.namespace ?? null,
      chainRef: chainRef as ChainRef,
    });

    const existing = await this.#service.getByOrigin({ origin, namespace });
    const nextGrants = upsertGrantChains(existing?.grants ?? [], { scope, chainRef: normalized });

    // Accounts require an explicit accountIds payload (via setPermittedAccounts) unless already present.
    // If accountIds already exist, we allow grant(Accounts) to extend the permitted chains list (used by chain switching).
    if (scope === PermissionScopes.Accounts && (!existing?.accountIds || existing.accountIds.length === 0)) {
      throw new Error("Accounts permission must be granted via setPermittedAccounts");
    }

    const includeAccounts = nextGrants.some((g) => g.scope === PermissionScopes.Accounts);
    const accountIds = includeAccounts ? existing?.accountIds : undefined;
    if (includeAccounts && (!accountIds || accountIds.length === 0)) {
      throw new Error("Invariant violation: existing Accounts permission is missing accountIds");
    }

    await this.#service.upsert({
      ...(existing?.id ? { id: existing.id } : {}),
      origin,
      namespace,
      grants: nextGrants,
      ...(includeAccounts ? { accountIds } : {}),
    });

    await this.#queueSyncFromStore();
  }

  async clear(origin: string): Promise<void> {
    await this.#service.clearOrigin(origin);
    await this.#queueSyncFromStore();
  }

  getPermissions(origin: string): OriginPermissionState | undefined {
    const namespaces = this.#state.origins[origin];
    return namespaces ? cloneState({ origins: { [origin]: namespaces } }).origins[origin] : undefined;
  }

  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_STATE_TOPIC, handler);
  }

  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_ORIGIN_TOPIC, handler);
  }

  async #queueSyncFromStore(params?: { origin?: string | null }): Promise<void> {
    const origin = params?.origin ?? null;
    if (origin) {
      this.#pendingOrigins.add(origin);
    } else {
      this.#pendingFullSync = true;
    }

    if (this.#syncPromise) {
      await this.#syncPromise;
      return;
    }

    this.#syncPromise = (async () => {
      try {
        // Drain sync requests; prefer a single full sync if requested.
        while (this.#pendingFullSync || this.#pendingOrigins.size > 0) {
          if (this.#pendingFullSync) {
            this.#pendingFullSync = false;
            this.#pendingOrigins.clear();
            await this.#syncAllFromStore();
            continue;
          }

          const origins = [...this.#pendingOrigins].sort();
          this.#pendingOrigins.clear();
          for (const origin of origins) {
            await this.#syncOriginFromStore(origin);
          }
        }
      } finally {
        this.#syncPromise = null;
      }
    })();

    await this.#syncPromise;
  }

  async #syncAllFromStore(): Promise<void> {
    const records = await this.#service.listAll();
    const nextState = buildStateFromRecords(records);

    const recordsByOrigin = new Map<string, PermissionRecord[]>();
    for (const record of records) {
      const list = recordsByOrigin.get(record.origin) ?? [];
      list.push(record);
      recordsByOrigin.set(record.origin, list);
    }

    const prevOrigins = new Set(Object.keys(this.#state.origins));
    const nextOrigins = new Set(Object.keys(nextState.origins));
    const allOrigins = new Set([...prevOrigins, ...nextOrigins]);

    const nextHashes: OriginHashMap = new Map();
    for (const [origin, originRecords] of recordsByOrigin.entries()) {
      nextHashes.set(origin, hashOriginRecords(originRecords));
    }

    const changedOrigins: string[] = [];
    for (const origin of allOrigins) {
      const prevHash = this.#originHash.get(origin) ?? "";
      const nextHash = nextHashes.get(origin) ?? "";
      if (prevHash !== nextHash) changedOrigins.push(origin);
    }

    if (changedOrigins.length === 0) return;

    this.#state = nextState;
    this.#originHash = nextHashes;
    this.#publishState();

    for (const origin of changedOrigins.sort((a, b) => a.localeCompare(b))) {
      this.#publishOrigin({ origin, namespaces: nextState.origins[origin] ?? {} });
    }
  }

  async #syncOriginFromStore(origin: string): Promise<void> {
    const records = await this.#service.listByOrigin(origin);
    const nextHash = hashOriginRecords(records);
    const prevHash = this.#originHash.get(origin) ?? "";

    if (prevHash === nextHash) return;

    const nextOrigins = { ...this.#state.origins };

    if (records.length === 0) {
      delete nextOrigins[origin];
      this.#originHash.delete(origin);
    } else {
      nextOrigins[origin] = buildOriginStateFromRecords(records);
      this.#originHash.set(origin, nextHash);
    }

    this.#state = { origins: nextOrigins };
    this.#publishState();
    this.#publishOrigin({ origin, namespaces: this.#state.origins[origin] ?? {} });
  }

  #publishState() {
    this.#messenger.publish(PERMISSION_STATE_TOPIC, cloneState(this.#state), { force: true });
  }

  #publishOrigin(payload: OriginPermissions) {
    const clonedNamespaces =
      cloneState({ origins: { [payload.origin]: payload.namespaces } }).origins[payload.origin] ?? {};
    this.#messenger.publish(
      PERMISSION_ORIGIN_TOPIC,
      { origin: payload.origin, namespaces: clonedNamespaces },
      { force: true },
    );
  }
}
