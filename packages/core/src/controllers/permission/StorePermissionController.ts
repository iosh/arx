import { parseChainRef as parseCaipChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainDescriptorRegistry, createDefaultChainDescriptorRegistry } from "../../chains/registry.js";
import { type PermissionRecord, PermissionRecordSchema } from "../../db/records.js";
import type { PermissionsService } from "../../services/permissions/types.js";
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

const cloneNamespaceState = (state: NamespacePermissionState): NamespacePermissionState => ({
  scopes: [...state.scopes],
  chains: [...state.chains],
  ...(state.accountsByChain
    ? {
        accountsByChain: Object.fromEntries(
          Object.entries(state.accountsByChain).map(([chainRef, accounts]) => [chainRef, [...accounts]]),
        ),
      }
    : {}),
});

const cloneOriginState = (state: OriginPermissionState): OriginPermissionState =>
  Object.fromEntries(
    Object.entries(state).map(([namespace, namespaceState]) => [namespace, cloneNamespaceState(namespaceState)]),
  );

const cloneState = (state: PermissionsState): PermissionsState => ({
  origins: Object.fromEntries(
    Object.entries(state.origins).map(([origin, originState]) => [origin, cloneOriginState(originState)]),
  ),
});

const isSameList = (prev: readonly string[], next: readonly string[]) => {
  return prev.length === next.length && prev.every((value, index) => value === next[index]);
};

const isSameNamespaceState = (prev: NamespacePermissionState, next: NamespacePermissionState) => {
  if (!isSameList(prev.scopes, next.scopes) || !isSameList(prev.chains, next.chains)) return false;

  const prevMap = prev.accountsByChain;
  const nextMap = next.accountsByChain;
  if (!prevMap && !nextMap) return true;
  if (!prevMap || !nextMap) return false;

  const prevKeys = Object.keys(prevMap).sort();
  const nextKeys = Object.keys(nextMap).sort();
  if (!isSameList(prevKeys, nextKeys)) return false;

  return prevKeys.every((key) => {
    const prevAccounts = prevMap[key as keyof typeof prevMap] ?? [];
    const nextAccounts = nextMap[key as keyof typeof nextMap] ?? [];
    return isSameList(prevAccounts, nextAccounts);
  });
};

const isSameOriginState = (prev: OriginPermissionState, next: OriginPermissionState) => {
  const prevNamespaces = Object.keys(prev).sort();
  const nextNamespaces = Object.keys(next).sort();
  if (prevNamespaces.length !== nextNamespaces.length) return false;

  return prevNamespaces.every((namespace) => {
    const prevState = prev[namespace];
    const nextState = next[namespace];
    if (!prevState || !nextState) return false;
    return isSameNamespaceState(prevState, nextState);
  });
};

const isSameState = (prev?: PermissionsState, next?: PermissionsState) => {
  if (!prev || !next) return false;

  const prevOrigins = Object.keys(prev.origins).sort();
  const nextOrigins = Object.keys(next.origins).sort();
  if (prevOrigins.length !== nextOrigins.length) return false;

  return prevOrigins.every((origin) => {
    const prevOriginState = prev.origins[origin];
    const nextOriginState = next.origins[origin];
    if (!prevOriginState || !nextOriginState) return false;
    return isSameOriginState(prevOriginState, nextOriginState);
  });
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

const toAccountIdFromEip155Address = (canonicalAddress: string): string => {
  const trimmed = canonicalAddress.trim();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return `eip155:${normalized.toLowerCase()}`;
};

const toEip155AddressFromAccountId = (accountId: string): string => {
  const [, payloadHex] = accountId.split(":");
  return `0x${(payloadHex ?? "").toLowerCase()}`;
};

const keyForRecord = (record: { origin: string; namespace: string }) => {
  return `${record.origin}::${record.namespace}`;
};

const keyForQuery = (origin: string, namespace: string) => {
  return `${origin}::${namespace}`;
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

const hasScopeForChain = (record: PermissionRecord, scope: PermissionScope, chainRef: ChainRef): boolean => {
  const grant = record.grants.find((g) => g.scope === scope);
  if (!grant) return false;
  return (grant.chains as ChainRef[]).includes(chainRef);
};

const buildStateFromRecords = (records: PermissionRecord[]): PermissionsState => {
  const origins: Record<string, OriginPermissionState> = {};

  for (const record of records) {
    const origin = record.origin;
    const namespace = record.namespace as ChainNamespace;

    const currentOrigin: OriginPermissionState = origins[origin] ?? {};

    const scopes = record.grants.map((grant) => grant.scope as PermissionScope);
    const chainSet = new Set<ChainRef>();
    for (const grant of record.grants) {
      for (const chain of grant.chains as ChainRef[]) {
        chainSet.add(chain);
      }
    }
    const chains = sortChains([...chainSet]) as ChainRef[];

    const nextNamespace: NamespacePermissionState = {
      scopes: sortScopes(scopes),
      chains,
    };

    if (namespace === "eip155" && scopes.includes(PermissionScopes.Accounts)) {
      const accounts = (record.accountIds ?? []).map((id) => toEip155AddressFromAccountId(id));
      if (accounts.length > 0 && chains.length > 0) {
        // Keep UI state shape stable: expose accounts per chain even when stored as namespace-wide.
        nextNamespace.accountsByChain = Object.fromEntries(chains.map((chainRef) => [chainRef, [...accounts]]));
      }
    }

    origins[origin] = {
      ...currentOrigin,
      [namespace]: nextNamespace,
    };
  }

  return { origins };
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
  #records: Map<string, PermissionRecord> = new Map();

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
    const grants: PermissionGrant[] = [];

    for (const record of this.#records.values()) {
      if (record.origin !== origin) continue;

      const namespace = record.namespace as ChainNamespace;
      const accounts =
        record.namespace === "eip155" && record.grants.some((g) => g.scope === PermissionScopes.Accounts)
          ? (record.accountIds ?? []).map((id) => toEip155AddressFromAccountId(id))
          : null;

      const scopesByChain = new Map<ChainRef, Set<PermissionScope>>();
      for (const entry of record.grants) {
        const scope = entry.scope as PermissionScope;
        for (const chainRef of entry.chains as ChainRef[]) {
          const set = scopesByChain.get(chainRef) ?? new Set<PermissionScope>();
          set.add(scope);
          scopesByChain.set(chainRef, set);
        }
      }

      for (const [chainRef, scopes] of scopesByChain.entries()) {
        const grant: PermissionGrant = {
          origin,
          namespace,
          chainRef,
          scopes: sortScopes([...scopes]),
          ...(accounts && accounts.length > 0 ? { accounts } : {}),
        };
        grants.push(grant);
      }
    }

    grants.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.chainRef.localeCompare(b.chainRef));
    return grants;
  }

  getState(): PermissionsState {
    return cloneState(this.#state);
  }

  getPermittedAccounts(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): string[] {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);
    const record = this.#records.get(keyForQuery(origin, namespace));
    if (!record) return [];
    if (record.namespace !== "eip155") return [];

    if (!hasScopeForChain(record, PermissionScopes.Accounts, chainRef)) return [];

    const ids = record.accountIds ?? [];
    return ids.map((id) => toEip155AddressFromAccountId(id));
  }

  isConnected(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): boolean {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);
    const record = this.#records.get(keyForQuery(origin, namespace));
    if (!record) return false;
    return hasScopeForChain(record, PermissionScopes.Accounts, chainRef);
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

    const accountIds = uniqueAccounts.map((address) => toAccountIdFromEip155Address(address));

    const existing = await this.#service.getByOrigin({ origin, namespace });
    const nextGrants = upsertGrantChains(existing?.grants ?? [], { scope: PermissionScopes.Accounts, chainRef });

    await this.#service.upsert(
      PermissionRecordSchema.parse({
        id: existing?.id ?? crypto.randomUUID(),
        origin,
        namespace,
        grants: nextGrants,
        accountIds,
        updatedAt: 0,
      }),
    );

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
    const record = this.#records.get(keyForQuery(origin, namespace));
    if (!record) {
      throw new Error(`Origin "${origin}" lacks scope "${scope}" for namespace "${namespace}"`);
    }

    if (parsedChain) {
      const chainRef = parsedChain.value;
      if (!hasScopeForChain(record, scope, chainRef)) {
        throw new Error(`Origin "${origin}" lacks scope "${scope}" for ${namespace} on chain "${chainRef}"`);
      }
      return;
    }

    // Fallback for contexts without an explicit chainRef.
    if (!record.grants.some((g) => g.scope === scope)) {
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

    await this.#service.upsert(
      PermissionRecordSchema.parse({
        id: existing?.id ?? crypto.randomUUID(),
        origin,
        namespace,
        grants: nextGrants,
        ...(includeAccounts ? { accountIds } : {}),
        updatedAt: 0,
      }),
    );

    await this.#queueSyncFromStore();
  }

  async clear(origin: string): Promise<void> {
    await this.#service.clearOrigin(origin);
    await this.#queueSyncFromStore();
  }

  getPermissions(origin: string): OriginPermissionState | undefined {
    const namespaces = this.#state.origins[origin];
    return namespaces ? cloneOriginState(namespaces) : undefined;
  }

  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_STATE_TOPIC, handler);
  }

  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_ORIGIN_TOPIC, handler);
  }

  replaceState(_state: PermissionsState): void {
    // Store-backed; legacy snapshot hydration is intentionally disabled.
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
    const nextRecords = new Map<string, PermissionRecord>();
    for (const record of records) {
      nextRecords.set(keyForRecord(record), record);
    }

    const prevState = this.#state;
    const nextState = buildStateFromRecords(records);
    this.#records = nextRecords;

    if (isSameState(prevState, nextState)) return;
    this.#state = cloneState(nextState);
    this.#publishState();

    const prevOrigins = new Set(Object.keys(prevState.origins));
    const nextOrigins = new Set(Object.keys(nextState.origins));
    const allOrigins = new Set([...prevOrigins, ...nextOrigins]);

    for (const origin of allOrigins) {
      const prevOrigin = prevState.origins[origin] ?? {};
      const nextOrigin = nextState.origins[origin] ?? {};
      if (isSameOriginState(prevOrigin, nextOrigin)) continue;
      this.#publishOrigin({ origin, namespaces: nextOrigin });
    }
  }

  async #syncOriginFromStore(origin: string): Promise<void> {
    const records = await this.#service.listByOrigin(origin);

    const prevState = this.#state;
    const prevOriginState = prevState.origins[origin] ?? null;

    const nextOriginState = buildStateFromRecords(records).origins[origin] ?? null;

    const nextOrigins = { ...prevState.origins };
    if (nextOriginState) {
      nextOrigins[origin] = nextOriginState;
    } else {
      delete nextOrigins[origin];
    }
    const nextState: PermissionsState = { origins: nextOrigins };

    // Update record cache for this origin only.
    const nextRecords = new Map(this.#records);
    for (const [key, record] of nextRecords.entries()) {
      if (record.origin === origin) {
        nextRecords.delete(key);
      }
    }
    for (const record of records) {
      nextRecords.set(keyForRecord(record), record);
    }
    this.#records = nextRecords;

    if (!isSameState(prevState, nextState)) {
      this.#state = cloneState(nextState);
      this.#publishState();
    }

    const prevOrigin = prevOriginState ?? {};
    const nextOrigin = nextOriginState ?? {};
    if (!isSameOriginState(prevOrigin, nextOrigin)) {
      this.#publishOrigin({ origin, namespaces: nextOrigin });
    }
  }

  #publishState() {
    this.#messenger.publish(PERMISSION_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #publishOrigin(payload: OriginPermissions) {
    this.#messenger.publish(
      PERMISSION_ORIGIN_TOPIC,
      { origin: payload.origin, namespaces: cloneOriginState(payload.namespaces) },
      {
        compare: (prev, next) => {
          if (!prev || !next) return false;
          return prev.origin === next.origin && isSameOriginState(prev.namespaces, next.namespaces);
        },
      },
    );
  }
}
