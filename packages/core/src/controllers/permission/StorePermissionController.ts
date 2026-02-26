import { toAccountIdFromAddress, toCanonicalAddressFromAccountId } from "../../accounts/accountId.js";
import { parseChainRef as parseCaipChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainDescriptorRegistry, createDefaultChainDescriptorRegistry } from "../../chains/registry.js";
import { sortPermissionCapabilities } from "../../permissions/capabilities.js";
import type { PermissionsService } from "../../services/store/permissions/types.js";
import type { PermissionRecord } from "../../storage/records.js";
import type { ChainNamespace } from "../account/types.js";
import { PERMISSION_ORIGIN_CHANGED, PERMISSION_STATE_CHANGED, type PermissionMessenger } from "./topics.js";
import {
  type GrantPermissionOptions,
  type NamespacePermissionState,
  type OriginPermissionState,
  type OriginPermissions,
  PermissionCapabilities,
  type PermissionCapability,
  type PermissionCapabilityResolver,
  type PermissionController,
  type PermissionGrant,
  type PermissionsState,
} from "./types.js";

const DEFAULT_PERMISSION_NAMESPACE: ChainNamespace = "eip155";

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
                  capabilities: [...chainState.capabilities],
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

type StablePermissionRecordSnapshot = {
  namespace: string;
  grants: Array<{ capability: string; chainRefs: ChainRef[] }>;
  accountIds: string[];
};

const stablePermissionRecordSnapshot = (record: PermissionRecord): StablePermissionRecordSnapshot => {
  const grants = [...record.grants]
    .map((g) => ({
      capability: String(g.capability),
      chainRefs: uniqSorted((g.chainRefs as ChainRef[]).map((c) => String(c) as ChainRef)),
    }))
    .sort((a, b) => a.capability.localeCompare(b.capability));

  const accountIds = (record.accountIds ?? []).map(String).sort((a, b) => a.localeCompare(b));

  return {
    namespace: String(record.namespace),
    grants,
    accountIds,
  };
};

const stablePermissionRecordValue = (record: PermissionRecord): string => {
  return JSON.stringify(stablePermissionRecordSnapshot(record));
};

const selectLatestByNamespace = (records: readonly PermissionRecord[]): Map<string, PermissionRecord> => {
  const winners = new Map<string, PermissionRecord>();

  for (const record of records) {
    const current = winners.get(record.namespace);
    if (!current) {
      winners.set(record.namespace, record);
      continue;
    }

    // Deterministic rule for safety against dirty stores:
    // - Prefer higher updatedAt (latest write)
    // - Tie-break by stable value for consistent results across list orders.
    if (record.updatedAt > current.updatedAt) {
      winners.set(record.namespace, record);
      continue;
    }
    if (record.updatedAt === current.updatedAt) {
      const nextValue = stablePermissionRecordValue(record);
      const currentValue = stablePermissionRecordValue(current);
      if (nextValue.localeCompare(currentValue) > 0) {
        winners.set(record.namespace, record);
      }
    }
  }

  return winners;
};

const hashOriginRecords = (records: PermissionRecord[]): string => {
  const winners = selectLatestByNamespace(records);

  // Use a stable JSON representation to avoid delimiter-collision footguns.
  const stable = [...winners.values()]
    .map(stablePermissionRecordSnapshot)
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

const deriveNamespaceFromContext = (context?: Parameters<PermissionCapabilityResolver>[1]): ChainNamespace => {
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
  params: { capability: PermissionCapability; chainRef: ChainRef },
): PermissionRecord["grants"] => {
  const next: PermissionRecord["grants"] = [];
  let updated = false;

  for (const grant of grants) {
    if (grant.capability !== params.capability) {
      next.push(grant);
      continue;
    }
    updated = true;
    const chainRefs = uniqSorted([...(grant.chainRefs as ChainRef[]), params.chainRef]);
    next.push({ ...grant, chainRefs });
  }

  if (!updated) {
    next.push({
      capability: params.capability,
      chainRefs: [params.chainRef],
    } as PermissionRecord["grants"][number]);
  }

  // Keep deterministic order for stable snapshots/tests.
  next.sort((a, b) => String(a.capability).localeCompare(String(b.capability)));
  return next;
};

const buildOriginStateFromRecords = (records: PermissionRecord[]): OriginPermissionState => {
  // One record per (origin, namespace). If the store is dirty, pick a deterministic winner.
  const byNamespace = selectLatestByNamespace(records);

  const originState: OriginPermissionState = {};

  for (const record of byNamespace.values()) {
    const namespace = record.namespace as ChainNamespace;

    const chainMap = new Map<
      ChainRef,
      {
        capabilities: Set<PermissionCapability>;
        accounts?: string[];
      }
    >();

    for (const grant of record.grants) {
      const capability = grant.capability as PermissionCapability;
      for (const chainRef of grant.chainRefs as ChainRef[]) {
        const entry = chainMap.get(chainRef) ?? { capabilities: new Set<PermissionCapability>() };
        entry.capabilities.add(capability);
        chainMap.set(chainRef, entry);
      }
    }

    // EIP-155 only: attach accounts ONLY to chains that have the Accounts capability caveat.
    if (namespace === "eip155" && record.accountIds?.length) {
      const accountsGrant = record.grants.find((g) => g.capability === PermissionCapabilities.Accounts);
      const permittedChains = (accountsGrant?.chainRefs ?? []) as ChainRef[];

      for (const chainRef of permittedChains) {
        const accounts = record.accountIds.map((accountId) => toCanonicalAddressFromAccountId({ chainRef, accountId }));
        const entry = chainMap.get(chainRef) ?? { capabilities: new Set<PermissionCapability>() };
        entry.capabilities.add(PermissionCapabilities.Accounts);
        entry.accounts = [...accounts];
        chainMap.set(chainRef, entry);
      }
    }

    const chains: NamespacePermissionState["chains"] = {};
    for (const chainRef of sortChains([...chainMap.keys()])) {
      const entry = chainMap.get(chainRef);
      if (!entry) continue;
      chains[chainRef] = {
        capabilities: sortPermissionCapabilities([...entry.capabilities]),
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
  capabilityResolver: PermissionCapabilityResolver;
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
  #capabilityResolver: PermissionCapabilityResolver;
  #service: PermissionsService;
  #chains: ChainDescriptorRegistry;
  #unsubscribeStore: (() => void) | null = null;
  #destroyed = false;

  #state: PermissionsState = { origins: {} };
  #originHash: OriginHashMap = new Map();

  #ready: Promise<void>;
  #syncPromise: Promise<void> | null = null;
  #pendingFullSync = false;
  #pendingOrigins: Set<string> = new Set();

  constructor({ messenger, capabilityResolver, service, chains }: StorePermissionControllerOptions) {
    this.#messenger = messenger;
    this.#capabilityResolver = capabilityResolver;
    this.#service = service;
    this.#chains = chains ?? createDefaultChainDescriptorRegistry();

    this.#unsubscribeStore = this.#service.subscribeChanged((event) => {
      if (this.#destroyed) return;
      void this.#queueSyncFromStore({ origin: event?.origin ?? null }).catch(() => {});
    });

    // lifecycle.initialize() awaits whenReady(); keep constructor side-effects best-effort.
    this.#ready = this.#queueSyncFromStore();
    this.#publishState();
  }

  destroy() {
    this.#destroyed = true;
    if (!this.#unsubscribeStore) return;
    try {
      this.#unsubscribeStore();
    } catch {
    } finally {
      this.#unsubscribeStore = null;
    }
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
          capabilities: [...chainState.capabilities],
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
        if (!chain.capabilities.includes(PermissionCapabilities.Accounts)) return false;
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
    if (!chainState.capabilities.includes(PermissionCapabilities.Accounts)) return [];
    return [...(chainState.accounts ?? [])];
  }

  isConnected(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): boolean {
    const { namespace, chainRef } = deriveNamespaceFromOptions(options);
    const chainState = this.#state.origins[origin]?.[namespace]?.chains?.[chainRef];
    if (!chainState?.capabilities.includes(PermissionCapabilities.Accounts)) return false;
    if (namespace === "eip155") {
      // Treat missing accounts as not-connected to avoid spreading dirty state.
      return (chainState.accounts?.length ?? 0) > 0;
    }
    return true;
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

    const existing = await this.#service.get({ origin, namespace });
    const nextGrants = upsertGrantChains(existing?.grants ?? [], {
      capability: PermissionCapabilities.Accounts,
      chainRef,
    });

    await this.#service.upsert({
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
    context?: Parameters<PermissionCapabilityResolver>[1],
  ): Promise<void> {
    const capability = this.#capabilityResolver(method, context);
    if (!capability) return;

    const namespace = deriveNamespaceFromContext(context);
    const parsedChain = tryParseChainRef(context?.chainRef ?? null);
    const nsState = this.#state.origins[origin]?.[namespace];
    if (!nsState) {
      throw new Error(`Origin "${origin}" lacks capability "${capability}" for namespace "${namespace}"`);
    }

    if (parsedChain) {
      const chainRef = parsedChain.value;
      const chainState = nsState.chains?.[chainRef];
      if (!chainState || !chainState.capabilities.includes(capability)) {
        throw new Error(`Origin "${origin}" lacks capability "${capability}" for ${namespace} on chain "${chainRef}"`);
      }
      return;
    }

    // Fallback for contexts without an explicit chainRef.
    const any = Object.values(nsState.chains).some((chain) => chain.capabilities.includes(capability));
    if (!any) {
      throw new Error(`Origin "${origin}" lacks capability "${capability}" for namespace "${namespace}"`);
    }
  }

  async grant(origin: string, capability: PermissionCapability, options?: GrantPermissionOptions): Promise<void> {
    const chainRef = options?.chainRef ?? null;
    if (!chainRef) throw new Error("StorePermissionController.grant requires a chainRef");
    const { namespace, chainRef: normalized } = deriveNamespaceFromOptions({
      namespace: options?.namespace ?? null,
      chainRef: chainRef as ChainRef,
    });

    const existing = await this.#service.get({ origin, namespace });
    const nextGrants = upsertGrantChains(existing?.grants ?? [], { capability, chainRef: normalized });

    // Accounts require an explicit accountIds payload (via setPermittedAccounts) unless already present.
    // If accountIds already exist, we allow grant(Accounts) to extend the permitted chains list (used by chain switching).
    if (capability === PermissionCapabilities.Accounts && (!existing?.accountIds || existing.accountIds.length === 0)) {
      throw new Error("Accounts permission must be granted via setPermittedAccounts");
    }

    const includeAccounts = nextGrants.some((g) => g.capability === PermissionCapabilities.Accounts);
    const accountIds = includeAccounts ? existing?.accountIds : undefined;
    if (includeAccounts && (!accountIds || accountIds.length === 0)) {
      throw new Error("Invariant violation: existing Accounts permission is missing accountIds");
    }

    await this.#service.upsert({
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
    return this.#messenger.subscribe(PERMISSION_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_ORIGIN_CHANGED, handler);
  }

  async #queueSyncFromStore(params?: { origin?: string | null }): Promise<void> {
    if (this.#destroyed) return;
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
    if (this.#destroyed) return;
    this.#messenger.publish(PERMISSION_STATE_CHANGED, cloneState(this.#state), { force: true });
  }

  #publishOrigin(payload: OriginPermissions) {
    if (this.#destroyed) return;
    const clonedNamespaces =
      cloneState({ origins: { [payload.origin]: payload.namespaces } }).origins[payload.origin] ?? {};
    this.#messenger.publish(
      PERMISSION_ORIGIN_CHANGED,
      { origin: payload.origin, namespaces: clonedNamespaces },
      { force: true },
    );
  }
}
