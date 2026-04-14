import { ArxReasons, arxError } from "@arx/errors";
import { getAccountKeyNamespace } from "../../accounts/addressing/accountKey.js";
import { parseChainRef as parseCaipChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import type { PermissionsService } from "../../services/store/permissions/types.js";
import type { AccountKey, PermissionRecord } from "../../storage/records.js";
import { PERMISSION_ORIGIN_CHANGED, PERMISSION_STATE_CHANGED, type PermissionMessenger } from "./topics.js";
import type {
  AuthorizationChainInput,
  ChainPermissionAuthorization,
  ChainPermissionState,
  GrantAuthorizationOptions,
  OriginPermissionState,
  OriginPermissions,
  PermissionAuthorization,
  PermissionController,
  PermissionsState,
  RevokeChainAuthorizationOptions,
  RevokeNamespaceAuthorizationOptions,
  SetChainAccountKeysOptions,
} from "./types.js";

const sortStrings = <T extends string>(values: readonly T[]): T[] => {
  return [...values].sort((left, right) => left.localeCompare(right));
};

const uniqSorted = <T extends string>(values: readonly T[]): T[] => {
  return sortStrings([...new Set(values)]);
};

const cloneChainStates = (chains: Record<ChainRef, ChainPermissionState>): Record<ChainRef, ChainPermissionState> => {
  return Object.fromEntries(
    Object.entries(chains).map(([chainRef, chainState]) => [
      chainRef,
      {
        accountKeys: [...chainState.accountKeys],
      },
    ]),
  ) as Record<ChainRef, ChainPermissionState>;
};

const cloneState = (state: PermissionsState): PermissionsState => ({
  origins: Object.fromEntries(
    Object.entries(state.origins).map(([origin, originState]) => [
      origin,
      Object.fromEntries(
        Object.entries(originState).map(([namespace, namespaceState]) => [
          namespace,
          {
            chains: cloneChainStates(namespaceState.chains),
          },
        ]),
      ) as OriginPermissionState,
    ]),
  ),
});

type OriginHashMap = Map<string, string>;

type StablePermissionRecordSnapshot = {
  namespace: string;
  chains: AuthorizationChainInput[];
};

const stablePermissionRecordSnapshot = (record: PermissionRecord): StablePermissionRecordSnapshot => ({
  namespace: String(record.namespace),
  chains: [...record.chains]
    .map((chain) => ({
      chainRef: String(chain.chainRef) as ChainRef,
      accountKeys: uniqSorted((chain.accountKeys as AccountKey[]).map((value) => String(value) as AccountKey)),
    }))
    .sort((left, right) => left.chainRef.localeCompare(right.chainRef)),
});

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
  const stable = [...winners.values()]
    .map(stablePermissionRecordSnapshot)
    .sort((left, right) => left.namespace.localeCompare(right.namespace));

  return JSON.stringify(stable);
};

const buildOriginStateFromRecords = (records: PermissionRecord[]): OriginPermissionState => {
  const byNamespace = selectLatestByNamespace(records);
  const originState: OriginPermissionState = {};

  for (const record of byNamespace.values()) {
    originState[record.namespace] = {
      chains: Object.fromEntries(
        stablePermissionRecordSnapshot(record).chains.map((chain) => [
          chain.chainRef,
          {
            accountKeys: [...chain.accountKeys],
          },
        ]),
      ) as Record<ChainRef, ChainPermissionState>,
    };
  }

  return originState;
};

const buildStateFromRecords = (records: PermissionRecord[]): PermissionsState => {
  const origins = new Map<string, PermissionRecord[]>();
  for (const record of records) {
    const current = origins.get(record.origin) ?? [];
    current.push(record);
    origins.set(record.origin, current);
  }

  const state: PermissionsState = { origins: {} };
  for (const [origin, originRecords] of origins.entries()) {
    state.origins[origin] = buildOriginStateFromRecords(originRecords);
  }

  return state;
};

const assertNamespace = (namespace: string) => {
  const normalized = namespace.trim();
  if (!normalized) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Permission namespace is required",
      data: { namespace },
    });
  }

  return normalized;
};

const normalizeChainRef = (namespace: string, chainRef: ChainRef): ChainRef => {
  const parsed = parseCaipChainRef(chainRef);
  if (parsed.namespace !== namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Permission chainRef "${chainRef}" does not belong to namespace "${namespace}"`,
      data: { namespace, chainRef },
    });
  }
  return `${parsed.namespace}:${parsed.reference}` as ChainRef;
};

const normalizeAccountKeys = (namespace: string, accountKeys: readonly AccountKey[]): AccountKey[] => {
  return uniqSorted(
    accountKeys.map((value) => {
      const accountKey = String(value) as AccountKey;
      if (getAccountKeyNamespace(accountKey) !== namespace) {
        throw arxError({
          reason: ArxReasons.RpcInvalidRequest,
          message: `Permission accountKey "${accountKey}" does not belong to namespace "${namespace}"`,
          data: { namespace, accountKey },
        });
      }
      return accountKey;
    }),
  );
};

const normalizeChains = (
  namespace: string,
  chains: readonly AuthorizationChainInput[],
): [AuthorizationChainInput, ...AuthorizationChainInput[]] => {
  if (chains.length === 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Permission chains must not be empty",
      data: { namespace },
    });
  }

  const seen = new Set<ChainRef>();
  const normalized = chains.map((chain) => {
    const normalizedChainRef = normalizeChainRef(namespace, chain.chainRef);
    if (seen.has(normalizedChainRef)) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `Permission chain "${normalizedChainRef}" is duplicated`,
        data: { namespace, chainRef: normalizedChainRef },
      });
    }
    seen.add(normalizedChainRef);

    return {
      chainRef: normalizedChainRef,
      accountKeys: normalizeAccountKeys(namespace, chain.accountKeys),
    };
  });

  return normalized.sort((left, right) => left.chainRef.localeCompare(right.chainRef)) as [
    AuthorizationChainInput,
    ...AuthorizationChainInput[],
  ];
};

const toChainMap = (chains: readonly AuthorizationChainInput[]): Record<ChainRef, ChainPermissionState> => {
  return Object.fromEntries(
    chains.map((chain) => [
      chain.chainRef,
      {
        accountKeys: [...chain.accountKeys],
      },
    ]),
  ) as Record<ChainRef, ChainPermissionState>;
};

const listStoredAuthorizationChains = (record: PermissionRecord): AuthorizationChainInput[] => {
  return [...stablePermissionRecordSnapshot(record).chains];
};

const mergeGrantedChains = (
  record: PermissionRecord | null,
  grantedChains: readonly AuthorizationChainInput[],
): AuthorizationChainInput[] => {
  // Grant only the requested chain scopes and leave unrelated stored chains intact.
  const nextChains = new Map<ChainRef, AuthorizationChainInput>();

  for (const chain of record ? listStoredAuthorizationChains(record) : []) {
    nextChains.set(chain.chainRef, {
      chainRef: chain.chainRef,
      accountKeys: [...chain.accountKeys],
    });
  }

  for (const chain of grantedChains) {
    nextChains.set(chain.chainRef, {
      chainRef: chain.chainRef,
      accountKeys: [...chain.accountKeys],
    });
  }

  return [...nextChains.values()].sort((left, right) => left.chainRef.localeCompare(right.chainRef));
};

const sameAuthorizationRecord = (record: PermissionRecord | null, next: readonly AuthorizationChainInput[]) => {
  if (!record) return false;
  return (
    JSON.stringify(stablePermissionRecordSnapshot(record).chains) ===
    JSON.stringify(normalizeChains(record.namespace, next))
  );
};

const toAuthorization = (
  origin: string,
  namespace: string,
  chains: Record<ChainRef, ChainPermissionState>,
): PermissionAuthorization => {
  return {
    origin,
    namespace,
    chains: cloneChainStates(chains),
  };
};

export type StorePermissionControllerOptions = {
  messenger: PermissionMessenger;
  service: PermissionsService;
};

export class StorePermissionController implements PermissionController {
  #messenger: PermissionMessenger;
  #service: PermissionsService;
  #unsubscribeStore: (() => void) | null = null;
  #destroyed = false;

  #state: PermissionsState = { origins: {} };
  #originHash: OriginHashMap = new Map();

  #ready: Promise<void>;
  #syncPromise: Promise<void> | null = null;
  #pendingFullSync = false;
  #pendingOrigins: Set<string> = new Set();

  constructor({ messenger, service }: StorePermissionControllerOptions) {
    this.#messenger = messenger;
    this.#service = service;

    this.#unsubscribeStore = this.#service.subscribeChanged((event) => {
      if (this.#destroyed) return;
      void this.#queueSyncFromStore({ origin: event?.origin ?? null }).catch(() => {});
    });

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

  getState(): PermissionsState {
    return cloneState(this.#state);
  }

  getAuthorization(origin: string, options: { namespace: string }): PermissionAuthorization | null {
    const namespace = assertNamespace(options.namespace);
    const entry = this.#state.origins[origin]?.[namespace];
    if (!entry) return null;

    return toAuthorization(origin, namespace, entry.chains);
  }

  getChainAuthorization(
    origin: string,
    options: { namespace: string; chainRef: ChainRef },
  ): ChainPermissionAuthorization | null {
    const namespace = assertNamespace(options.namespace);
    const chainRef = normalizeChainRef(namespace, options.chainRef);
    const chain = this.#state.origins[origin]?.[namespace]?.chains[chainRef];
    if (!chain) return null;

    return {
      origin,
      namespace,
      chainRef,
      accountKeys: [...chain.accountKeys],
    };
  }

  listOriginPermissions(origin: string): PermissionAuthorization[] {
    const namespaces = this.#state.origins[origin];
    if (!namespaces) return [];

    return sortStrings(Object.keys(namespaces)).flatMap((namespace) => {
      const entry = namespaces[namespace];
      if (!entry) return [];

      return [toAuthorization(origin, namespace, entry.chains)];
    });
  }

  async grantAuthorization(origin: string, options: GrantAuthorizationOptions): Promise<PermissionAuthorization> {
    const namespace = assertNamespace(options.namespace);
    const grantedChains = normalizeChains(namespace, options.chains);

    const existing = await this.#service.get({ origin, namespace });
    const nextChains = mergeGrantedChains(existing, grantedChains);

    if (!sameAuthorizationRecord(existing, nextChains)) {
      await this.#service.upsert({
        origin,
        namespace,
        chains: normalizeChains(namespace, nextChains),
      });
      await this.#queueSyncFromStore({ origin });
    }

    return toAuthorization(origin, namespace, toChainMap(nextChains));
  }

  async setChainAccountKeys(origin: string, options: SetChainAccountKeysOptions): Promise<PermissionAuthorization> {
    const namespace = assertNamespace(options.namespace);
    const existing = await this.#service.get({ origin, namespace });
    if (!existing) {
      throw arxError({
        reason: ArxReasons.PermissionNotConnected,
        message: `Origin "${origin}" is not connected to namespace "${namespace}"`,
        data: { origin, namespace },
      });
    }

    const chainRef = normalizeChainRef(namespace, options.chainRef);
    const accountKeys = normalizeAccountKeys(namespace, options.accountKeys);
    const nextChains = listStoredAuthorizationChains(existing);
    const targetIndex = nextChains.findIndex((chain) => chain.chainRef === chainRef);

    if (targetIndex < 0) {
      throw arxError({
        reason: ArxReasons.PermissionNotConnected,
        message: `Origin "${origin}" is not connected to chain "${chainRef}"`,
        data: { origin, namespace, chainRef },
      });
    }

    nextChains[targetIndex] = { chainRef, accountKeys };

    if (!sameAuthorizationRecord(existing, nextChains)) {
      await this.#service.upsert({
        origin,
        namespace,
        chains: normalizeChains(namespace, nextChains),
      });
      await this.#queueSyncFromStore({ origin });
    }

    return toAuthorization(origin, namespace, toChainMap(nextChains));
  }

  async revokeChainAuthorization(origin: string, options: RevokeChainAuthorizationOptions): Promise<void> {
    const namespace = assertNamespace(options.namespace);
    const existing = await this.#service.get({ origin, namespace });
    if (!existing) {
      return;
    }

    const chainRef = normalizeChainRef(namespace, options.chainRef);
    const remaining = listStoredAuthorizationChains(existing).filter((chain) => chain.chainRef !== chainRef);

    if (remaining.length === 0) {
      await this.#service.remove({ origin, namespace });
      await this.#queueSyncFromStore({ origin });
      return;
    }

    if (!sameAuthorizationRecord(existing, remaining)) {
      await this.#service.upsert({
        origin,
        namespace,
        chains: normalizeChains(namespace, remaining),
      });
      await this.#queueSyncFromStore({ origin });
    }
  }

  async revokeNamespaceAuthorization(origin: string, options: RevokeNamespaceAuthorizationOptions): Promise<void> {
    const namespace = assertNamespace(options.namespace);
    await this.#service.remove({ origin, namespace });
    await this.#queueSyncFromStore({ origin });
  }

  async revokeOriginPermissions(origin: string): Promise<void> {
    await this.#service.clearOrigin(origin);
    await this.#queueSyncFromStore({ origin });
  }

  onStateChanged(handler: (state: PermissionsState) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onOriginChanged(handler: (payload: OriginPermissions) => void): () => void {
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
        while (this.#pendingFullSync || this.#pendingOrigins.size > 0) {
          if (this.#pendingFullSync) {
            this.#pendingFullSync = false;
            this.#pendingOrigins.clear();
            await this.#syncAllFromStore();
            continue;
          }

          const origins = sortStrings([...this.#pendingOrigins]);
          this.#pendingOrigins.clear();
          for (const queuedOrigin of origins) {
            await this.#syncOriginFromStore(queuedOrigin);
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
      if (prevHash !== nextHash) {
        changedOrigins.push(origin);
      }
    }

    if (changedOrigins.length === 0) return;

    this.#state = nextState;
    this.#originHash = nextHashes;
    this.#publishState();

    for (const origin of sortStrings(changedOrigins)) {
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
