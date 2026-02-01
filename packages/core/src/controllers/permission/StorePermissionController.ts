import type { ChainRef } from "../../chains/ids.js";
import { type ChainModuleRegistry, createDefaultChainModuleRegistry } from "../../chains/registry.js";
import type { PermissionRecord } from "../../db/records.js";
import type { PermissionsService } from "../../services/permissions/types.js";
import type { ChainNamespace } from "../account/types.js";
import {
  type GrantPermissionOptions,
  type NamespacePermissionState,
  type OriginPermissionState,
  type OriginPermissions,
  type PermissionController,
  type PermissionControllerOptions,
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

type ParsedChainRef = {
  namespace: ChainNamespace;
  value: string;
};

const parseChainRef = (chainRef: string | null | undefined): ParsedChainRef | null => {
  if (!chainRef || typeof chainRef !== "string") return null;
  const [namespace, reference] = chainRef.split(":");
  if (!namespace || !reference) return null;
  return {
    namespace: namespace as ChainNamespace,
    value: `${namespace}:${reference}`,
  };
};

const deriveNamespaceFromContext = (context?: Parameters<PermissionScopeResolver>[1]): ChainNamespace => {
  if (context?.namespace) return context.namespace as ChainNamespace;
  const parsed = parseChainRef(context?.chainRef ?? null);
  return parsed?.namespace ?? DEFAULT_PERMISSION_NAMESPACE;
};

const deriveNamespaceFromOptions = (options: {
  namespace?: ChainNamespace | null;
  chainRef: ChainRef;
}): { namespace: ChainNamespace; chainRef: ChainRef } => {
  const parsed = parseChainRef(options.chainRef);
  const namespace = (options.namespace ?? parsed?.namespace ?? DEFAULT_PERMISSION_NAMESPACE) as ChainNamespace;
  const normalized = (parsed?.value ?? options.chainRef) as ChainRef;

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

const keyForRecord = (record: { origin: string; namespace: string; chainRef: string }) => {
  return `${record.origin}::${record.namespace}::${record.chainRef}`;
};

const keyForQuery = (origin: string, namespace: string, chainRef: string) => {
  return `${origin}::${namespace}::${chainRef}`;
};

const buildStateFromRecords = (records: PermissionRecord[]): PermissionsState => {
  const origins: Record<string, OriginPermissionState> = {};

  for (const record of records) {
    const origin = record.origin;
    const namespace = record.namespace as ChainNamespace;
    const chainRef = record.chainRef as ChainRef;

    const currentOrigin: OriginPermissionState = origins[origin] ?? {};
    const currentNamespace: NamespacePermissionState = currentOrigin[namespace] ?? { scopes: [], chains: [] };

    const nextScopes = new Set<PermissionScope>(currentNamespace.scopes);
    for (const scope of record.scopes as PermissionScope[]) nextScopes.add(scope);

    const nextChains = currentNamespace.chains.includes(chainRef)
      ? [...currentNamespace.chains]
      : [...currentNamespace.chains, chainRef];

    const nextNamespace: NamespacePermissionState = {
      scopes: sortScopes([...nextScopes]),
      chains: sortChains(nextChains) as ChainRef[],
      ...(currentNamespace.accountsByChain ? { accountsByChain: { ...currentNamespace.accountsByChain } } : {}),
    };

    if (record.scopes.includes(PermissionScopes.Accounts)) {
      if (record.namespace === "eip155") {
        const accounts = (record.accountIds ?? []).map((id) => toEip155AddressFromAccountId(id));
        const nextAccountsByChain = { ...(nextNamespace.accountsByChain ?? {}) };
        nextAccountsByChain[chainRef] = accounts;
        nextNamespace.accountsByChain = nextAccountsByChain;
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
  #chains: ChainModuleRegistry;

  #state: PermissionsState = { origins: {} };
  #records: Map<string, PermissionRecord> = new Map();

  #ready: Promise<void>;
  #syncPromise: Promise<void> | null = null;
  #pendingFullSync = false;
  #pendingOrigins: Set<string> = new Set();

  constructor({ messenger, scopeResolver, service }: StorePermissionControllerOptions) {
    this.#messenger = messenger;
    this.#scopeResolver = scopeResolver;
    this.#service = service;
    this.#chains = createDefaultChainModuleRegistry();

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

      const grant: PermissionGrant = {
        origin,
        namespace: record.namespace as ChainNamespace,
        chainRef: record.chainRef as ChainRef,
        scopes: sortScopes(record.scopes as PermissionScope[]),
      };

      if (record.namespace === "eip155" && record.scopes.includes(PermissionScopes.Accounts)) {
        grant.accounts = (record.accountIds ?? []).map((id) => toEip155AddressFromAccountId(id));
      }

      grants.push(grant);
    }

    grants.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.chainRef.localeCompare(b.chainRef));
    return grants;
  }

  getState(): PermissionsState {
    return cloneState(this.#state);
  }

  getPermittedAccounts(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): string[] {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);
    const record = this.#records.get(keyForQuery(origin, namespace, chainRef));
    if (!record || !record.scopes.includes(PermissionScopes.Accounts)) return [];
    if (record.namespace !== "eip155") return [];

    const ids = record.accountIds ?? [];
    return ids.map((id) => toEip155AddressFromAccountId(id));
  }

  isConnected(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): boolean {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);
    const record = this.#records.get(keyForQuery(origin, namespace, chainRef));
    return Boolean(record && record.scopes.includes(PermissionScopes.Accounts));
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

    const existing = await this.#service.getByOrigin({ origin, namespace, chainRef });

    const nextScopes = new Set<PermissionScope>(existing?.scopes ?? []);
    nextScopes.add(PermissionScopes.Accounts);

    const accountIds = uniqueAccounts.map((address) => toAccountIdFromEip155Address(address));

    await this.#service.upsert({
      id: existing?.id ?? crypto.randomUUID(),
      origin,
      namespace,
      chainRef,
      scopes: [...nextScopes],
      accountIds,
      updatedAt: 0,
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
    const parsedChain = parseChainRef(context?.chainRef ?? null);

    if (parsedChain) {
      const record = this.#records.get(keyForQuery(origin, namespace, parsedChain.value));
      if (!record || !record.scopes.includes(scope)) {
        throw new Error(`Origin "${origin}" lacks scope "${scope}" for ${namespace} on chain "${parsedChain.value}"`);
      }
      return;
    }

    // Fallback for contexts without an explicit chainRef.
    const permissions = this.#state.origins[origin]?.[namespace];
    if (!permissions || !permissions.scopes.includes(scope)) {
      throw new Error(`Origin "${origin}" lacks scope "${scope}" for namespace "${namespace}"`);
    }
  }

  async grant(origin: string, scope: PermissionScope, options?: GrantPermissionOptions): Promise<void> {
    const parsedChain = parseChainRef(options?.chainRef ?? null);
    const namespace = options?.namespace ?? parsedChain?.namespace ?? DEFAULT_PERMISSION_NAMESPACE;
    const normalizedChainRef = parsedChain?.value ?? null;

    if (!normalizedChainRef) {
      throw new Error("StorePermissionController.grant requires a chainRef");
    }

    if (options?.namespace && parsedChain && parsedChain.namespace !== options.namespace) {
      throw new Error(
        `Grant namespace mismatch: chainRef "${parsedChain.value}" belongs to namespace "${parsedChain.namespace}" but "${options.namespace}" was provided`,
      );
    }

    if (scope === PermissionScopes.Accounts) {
      throw new Error("Accounts permission must be granted via setPermittedAccounts");
    }

    const existing = await this.#service.getByOrigin({ origin, namespace, chainRef: normalizedChainRef as ChainRef });

    const nextScopes = new Set<PermissionScope>(existing?.scopes ?? []);
    nextScopes.add(scope);

    // Preserve accountIds only if Accounts is already present.
    const includeAccounts = existing?.scopes?.includes(PermissionScopes.Accounts) ?? false;

    if (includeAccounts && (!existing?.accountIds || existing.accountIds.length === 0)) {
      throw new Error("Invariant violation: existing Accounts permission is missing accountIds");
    }

    await this.#service.upsert({
      id: existing?.id ?? crypto.randomUUID(),
      origin,
      namespace,
      chainRef: normalizedChainRef as ChainRef,
      scopes: [...nextScopes],
      ...(includeAccounts ? { accountIds: existing!.accountIds } : {}),
      updatedAt: 0,
    });

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
