import type { JsonRpcParams } from "@metamask/utils";
import { buildAccountAddressingByNamespace, eip155AccountAddressing } from "../../accounts/addressing/addressing.js";
import { ApprovalKinds } from "../../approvals/queue/types.js";
import { buildChainAddressingByNamespace } from "../../chains/addressing.js";
import { getChainRefNamespace } from "../../chains/caip.js";
import { DEFAULT_CHAIN_DEFINITION_SEEDS } from "../../chains/chains.seed.js";
import {
  type ChainDefinition,
  type ChainDefinitionSeed,
  cloneChainDefinition,
  type RpcEndpoint,
} from "../../chains/definition.js";
import { eip155ChainAddressing } from "../../chains/eip155/chainAddressing.js";
import type { ChainRef } from "../../chains/ids.js";
import { eip155NamespaceManifest } from "../../namespaces/eip155/manifest.js";
import type { RpcInvocationHint } from "../../rpc/index.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import type { ChainDefinitionsPort } from "../../services/store/chainDefinitions/port.js";
import type { ChainRpcDefaultEndpointsPort } from "../../services/store/chainRpcDefaultEndpoints/port.js";
import type { ChainRpcEndpointOverridesPort } from "../../services/store/chainRpcEndpointOverrides/port.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { ProviderChainSelectionPort } from "../../services/store/providerChainSelection/port.js";
import type { WalletChainSelectionPort } from "../../services/store/walletChainSelection/port.js";
import type { ChainDefinitionEntity, VaultMetaPort, VaultMetaSnapshot } from "../../storage/index.js";
import type {
  AccountRecord,
  AccountSelectionStateRecord,
  ChainRpcDefaultEndpointsRecord,
  ChainRpcEndpointOverrideRecord,
  KeyringMetaRecord,
  PermissionRecord,
  ProviderChainSelectionRecord,
  WalletChainSelectionRecord,
} from "../../storage/records.js";
import type {
  TransactionRecord as AggregateTransactionRecord,
  ListRecoverableTransactionAggregatesQuery,
  ListTransactionHistoryQuery,
  TransactionAggregate,
  TransactionConflictKey,
  TransactionsStoragePort,
} from "../../transactions/storage/index.js";
import {
  findBlockingActiveTransactionRecords,
  TransactionAggregateAlreadyExistsError,
  TransactionAggregateNotFoundError,
  TransactionConflictKeyCollisionError,
} from "../../transactions/storage/index.js";
import { VaultInvalidPasswordError, VaultLockedError, VaultNotInitializedError } from "../../vault/errors.js";
import type { VaultEnvelope, VaultService } from "../../vault/types.js";
import type { BackgroundRpcAccessPolicyHooks } from "../background/rpcAccessPolicy.js";
import { type CreateBackgroundRuntimeOptions, createBackgroundRuntime } from "../createBackgroundRuntime.js";

// Test constants
export const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const TEST_AUTO_LOCK_DURATION = 1_000;
export const TEST_INITIAL_TIME = 5_000;
export const TEST_RECEIPT_POLL_INTERVAL = 3_000;
export const TEST_RECEIPT_MAX_DELAY = 30_000;
export const TEST_NAMESPACE_MANIFESTS = [eip155NamespaceManifest] as const;
export const TEST_ACCOUNT_CODECS = buildAccountAddressingByNamespace([eip155AccountAddressing]);
export const TEST_CHAIN_ADDRESS_CODECS = buildChainAddressingByNamespace([eip155ChainAddressing]);

// Utility types
export type RpcTimers = {
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

export type CreateBackgroundRuntimeResult = ReturnType<typeof createBackgroundRuntime>;

// Utility functions
export const clone = <T>(value: T): T => structuredClone(value);

export class MemoryPermissionsPort implements PermissionsPort {
  #records = new Map<string, PermissionRecord>();

  constructor(seed: PermissionRecord[] = []) {
    for (const record of seed) {
      this.#records.set(`${record.origin}::${record.namespace}`, clone(record));
    }
  }

  async get(params: { origin: string; namespace: string }): Promise<PermissionRecord | null> {
    const found = this.#records.get(`${params.origin}::${params.namespace}`);
    return found ? clone(found) : null;
  }

  async listAll(): Promise<PermissionRecord[]> {
    return Array.from(this.#records.values()).map((record) => clone(record));
  }

  async listByOrigin(origin: string): Promise<PermissionRecord[]> {
    return Array.from(this.#records.values())
      .filter((record) => record.origin === origin)
      .map((record) => clone(record));
  }

  async upsert(record: PermissionRecord): Promise<void> {
    this.#records.set(`${record.origin}::${record.namespace}`, clone(record));
  }

  async remove(params: { origin: string; namespace: string }): Promise<void> {
    this.#records.delete(`${params.origin}::${params.namespace}`);
  }

  async clearOrigin(origin: string): Promise<void> {
    for (const [id, record] of this.#records.entries()) {
      if (record.origin === origin) {
        this.#records.delete(id);
      }
    }
  }
}

export class MemoryTransactionAggregatesPort implements TransactionsStoragePort {
  #aggregates = new Map<string, TransactionAggregate>();

  async loadTransactionAggregate(transactionId: string): Promise<TransactionAggregate | null> {
    const aggregate = this.#aggregates.get(transactionId);
    return aggregate ? clone(aggregate) : null;
  }

  async insertTransactionAggregate(aggregate: TransactionAggregate): Promise<void> {
    if (this.#aggregates.has(aggregate.record.id)) {
      throw new TransactionAggregateAlreadyExistsError(aggregate.record.id);
    }
    this.#aggregates.set(aggregate.record.id, clone(aggregate));
  }

  async saveTransactionAggregate(aggregate: TransactionAggregate): Promise<void> {
    if (!this.#aggregates.has(aggregate.record.id)) {
      throw new TransactionAggregateNotFoundError(aggregate.record.id);
    }
    this.#aggregates.set(aggregate.record.id, clone(aggregate));
  }

  async insertApprovedTransactionAggregate(input: { aggregate: TransactionAggregate }): Promise<void> {
    const aggregate = input.aggregate;
    if (this.#aggregates.has(aggregate.record.id)) {
      throw new TransactionAggregateAlreadyExistsError(aggregate.record.id);
    }

    const conflictKey = aggregate.record.conflictKey;
    if (conflictKey) {
      const candidates = await this.findTransactionRecordsByConflictKey(conflictKey);
      const conflicting = findBlockingActiveTransactionRecords(aggregate.record, candidates);
      if (conflicting.length > 0) {
        throw new TransactionConflictKeyCollisionError({
          transactionId: aggregate.record.id,
          conflictKey,
          conflictingTransactionIds: conflicting.map((record) => record.id),
        });
      }
    }

    this.#aggregates.set(aggregate.record.id, clone(aggregate));
  }

  async listTransactionHistory(query: ListTransactionHistoryQuery = {}): Promise<AggregateTransactionRecord[]> {
    let records = Array.from(this.#aggregates.values()).map((aggregate) => clone(aggregate.record));
    if (query.namespace !== undefined) records = records.filter((record) => record.namespace === query.namespace);
    if (query.chainRef !== undefined) records = records.filter((record) => record.chainRef === query.chainRef);
    if (query.accountId !== undefined) records = records.filter((record) => record.accountId === query.accountId);
    if (query.status !== undefined) records = records.filter((record) => record.status === query.status);
    if (query.before !== undefined) {
      const before = query.before;
      records = records.filter(
        (record) =>
          record.createdAt < before.createdAt ||
          (record.createdAt === before.createdAt && record.id.localeCompare(before.id) < 0),
      );
    }
    records.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
    return records.slice(0, query.limit ?? records.length);
  }

  async findTransactionRecordsByConflictKey(key: TransactionConflictKey): Promise<AggregateTransactionRecord[]> {
    const records = await this.listTransactionHistory();
    return records.filter((record) => record.conflictKey?.kind === key.kind && record.conflictKey.value === key.value);
  }

  async listRecoverableTransactionAggregates(
    query: ListRecoverableTransactionAggregatesQuery = {},
  ): Promise<TransactionAggregate[]> {
    const aggregates = Array.from(this.#aggregates.values())
      .filter((aggregate) => ["submitting", "submitted"].includes(aggregate.record.status))
      .map((aggregate) => clone(aggregate))
      .sort(
        (left, right) =>
          right.record.createdAt - left.record.createdAt || right.record.id.localeCompare(left.record.id),
      );
    return aggregates.slice(0, query.limit ?? aggregates.length);
  }
}

export class MemoryAccountsPort implements AccountsPort {
  #records = new Map<string, AccountRecord>();
  #selectionState: AccountSelectionStateRecord | null;
  public readonly savedSelectionStates: AccountSelectionStateRecord[] = [];

  constructor(seed: AccountRecord[] = [], selectionState: AccountSelectionStateRecord | null = null) {
    for (const record of seed) {
      this.#records.set(record.accountId, clone(record));
    }
    this.#selectionState = selectionState ? clone(selectionState) : null;
  }

  async get(accountId: string): Promise<AccountRecord | null> {
    const found = this.#records.get(accountId);
    return found ? clone(found) : null;
  }

  async list(): Promise<AccountRecord[]> {
    return Array.from(this.#records.values())
      .map((record) => clone(record))
      .sort((a, b) => a.createdAt - b.createdAt || a.accountId.localeCompare(b.accountId));
  }

  async upsert(record: AccountRecord): Promise<void> {
    this.#records.set(record.accountId, clone(record));
  }

  async remove(accountId: string): Promise<void> {
    this.#records.delete(accountId);
  }

  async removeByKeyringId(keyringId: string): Promise<void> {
    for (const [accountId, record] of Array.from(this.#records.entries())) {
      if (record.keyringId === keyringId) {
        this.#records.delete(accountId);
      }
    }
  }

  async getSelectionState(): Promise<AccountSelectionStateRecord | null> {
    return this.#selectionState ? clone(this.#selectionState) : null;
  }

  async putSelectionState(record: AccountSelectionStateRecord): Promise<void> {
    this.#selectionState = clone(record);
    this.savedSelectionStates.push(clone(record));
  }
}

export class MemoryKeyringMetasPort implements KeyringMetasPort {
  #records = new Map<string, KeyringMetaRecord>();

  constructor(seed: KeyringMetaRecord[] = []) {
    for (const record of seed) {
      this.#records.set(record.id, clone(record));
    }
  }

  async get(id: string): Promise<KeyringMetaRecord | null> {
    const found = this.#records.get(id);
    return found ? clone(found) : null;
  }

  async list(): Promise<KeyringMetaRecord[]> {
    return Array.from(this.#records.values())
      .map((record) => clone(record))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  async upsert(record: KeyringMetaRecord): Promise<void> {
    this.#records.set(record.id, clone(record));
  }

  async remove(id: string): Promise<void> {
    this.#records.delete(id);
  }
}

const defaultBaseChainDefinition = DEFAULT_CHAIN_DEFINITION_SEEDS[0]?.definition;
if (!defaultBaseChainDefinition) {
  throw new Error("Missing DEFAULT_CHAIN_DEFINITION_SEEDS seed");
}
export const baseChainDefinition = cloneChainDefinition(defaultBaseChainDefinition);

const requireActiveChainDefinition = (runtime: CreateBackgroundRuntimeResult): ChainDefinition => {
  const view = runtime.services.chainViews.getSelectedChainView();
  const chainRef = view.chainRef;
  const chain = runtime.services.chainDefinitions.getChain(chainRef)?.definition ?? null;
  if (!chain) {
    throw new Error(`Missing chain definition for selected chain ${chainRef}`);
  }
  return cloneChainDefinition(chain);
};

const DEFAULT_FLUSH_TURNS = 8;

export const flushAsync = async (turns = DEFAULT_FLUSH_TURNS) => {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
};

/**
 * Produces minimal chain definitions for tests while allowing selective overrides.
 */
export const createChainDefinition = (overrides: Partial<ChainDefinition> = {}): ChainDefinition => {
  const definition: ChainDefinition = {
    chainRef: overrides.chainRef ?? baseChainDefinition.chainRef,
    displayName: overrides.displayName ?? baseChainDefinition.displayName,
    shortName: overrides.shortName ?? baseChainDefinition.shortName,
    nativeCurrency: overrides.nativeCurrency ?? clone(baseChainDefinition.nativeCurrency),
  };

  if (overrides.blockExplorers) {
    definition.blockExplorers = clone(overrides.blockExplorers);
  } else if (baseChainDefinition.blockExplorers) {
    definition.blockExplorers = clone(baseChainDefinition.blockExplorers);
  }

  if (overrides.icon) {
    definition.icon = overrides.icon;
  } else if (baseChainDefinition.icon) {
    definition.icon = baseChainDefinition.icon;
  }

  return definition;
};

type TestChainSeedInput = ChainDefinitionSeed<RpcEndpoint> | ChainDefinition;

const createDefaultRpcEndpointsForTest = (chainRef: ChainRef): RpcEndpoint[] => [
  {
    url: `https://rpc.${chainRef.replace(":", "-")}.example`,
    type: "public",
  },
];

export const createChainDefinitionSeed = (
  overrides: Partial<ChainDefinition> & { defaultRpcEndpoints?: readonly RpcEndpoint[] } = {},
): ChainDefinitionSeed<RpcEndpoint> => {
  const definition = createChainDefinition(overrides);
  return {
    definition: cloneChainDefinition(definition),
    defaultRpcEndpoints: overrides.defaultRpcEndpoints
      ? clone(overrides.defaultRpcEndpoints)
      : createDefaultRpcEndpointsForTest(definition.chainRef),
  };
};

const toChainDefinitionSeed = (input: TestChainSeedInput): ChainDefinitionSeed<RpcEndpoint> => {
  if ("definition" in input) {
    return {
      definition: clone(input.definition),
      ...(input.defaultRpcEndpoints ? { defaultRpcEndpoints: clone(input.defaultRpcEndpoints) } : {}),
    };
  }

  return createChainDefinitionSeed(input);
};

export class MemoryWalletChainSelectionPort implements WalletChainSelectionPort {
  #record: WalletChainSelectionRecord | null;
  public readonly saved: WalletChainSelectionRecord[] = [];

  constructor(seed: WalletChainSelectionRecord | null = null) {
    this.#record = seed ? clone(seed) : null;
  }

  async get(): Promise<WalletChainSelectionRecord | null> {
    return this.#record ? clone(this.#record) : null;
  }

  async put(record: WalletChainSelectionRecord): Promise<void> {
    this.#record = clone(record);
    this.saved.push(clone(record));
  }
}

export class MemoryProviderChainSelectionPort implements ProviderChainSelectionPort {
  #records = new Map<string, Map<string, ProviderChainSelectionRecord>>();
  public readonly saved: ProviderChainSelectionRecord[] = [];
  public readonly removed: Array<{ origin: string; namespace: string }> = [];

  constructor(seed: ProviderChainSelectionRecord[] = []) {
    for (const record of seed) {
      this.writeRecord(record);
    }
  }

  private writeRecord(record: ProviderChainSelectionRecord) {
    let recordsByNamespace = this.#records.get(record.origin);
    if (!recordsByNamespace) {
      recordsByNamespace = new Map();
      this.#records.set(record.origin, recordsByNamespace);
    }
    recordsByNamespace.set(record.namespace, clone(record));
  }

  private listRecords(): ProviderChainSelectionRecord[] {
    const records: ProviderChainSelectionRecord[] = [];
    for (const recordsByNamespace of this.#records.values()) {
      records.push(...recordsByNamespace.values());
    }
    return records;
  }

  async get(params: { origin: string; namespace: string }): Promise<ProviderChainSelectionRecord | null> {
    const record = this.#records.get(params.origin)?.get(params.namespace) ?? null;
    return record ? clone(record) : null;
  }

  async listAll(): Promise<ProviderChainSelectionRecord[]> {
    return this.listRecords().map((record) => clone(record));
  }

  async upsert(record: ProviderChainSelectionRecord): Promise<void> {
    this.writeRecord(record);
    this.saved.push(clone(record));
  }

  async remove(params: { origin: string; namespace: string }): Promise<void> {
    const recordsByNamespace = this.#records.get(params.origin);
    recordsByNamespace?.delete(params.namespace);
    if (recordsByNamespace?.size === 0) {
      this.#records.delete(params.origin);
    }
    this.removed.push(clone(params));
  }
}

export class MemoryChainRpcEndpointOverridesPort implements ChainRpcEndpointOverridesPort {
  #records = new Map<ChainRef, ChainRpcEndpointOverrideRecord>();
  public readonly upserted: ChainRpcEndpointOverrideRecord[] = [];
  public readonly removed: ChainRef[] = [];

  constructor(seed: ChainRpcEndpointOverrideRecord[] = []) {
    for (const record of seed) {
      this.#records.set(record.chainRef, clone(record));
    }
  }

  async get(chainRef: ChainRef): Promise<ChainRpcEndpointOverrideRecord | null> {
    const record = this.#records.get(chainRef);
    return record ? clone(record) : null;
  }

  async list(): Promise<ChainRpcEndpointOverrideRecord[]> {
    return Array.from(this.#records.values(), (record) => clone(record));
  }

  async upsert(record: ChainRpcEndpointOverrideRecord): Promise<void> {
    this.#records.set(record.chainRef, clone(record));
    this.upserted.push(clone(record));
  }

  async remove(chainRef: ChainRef): Promise<void> {
    this.#records.delete(chainRef);
    this.removed.push(chainRef);
  }

  async clear(): Promise<void> {
    this.#records.clear();
  }
}

export class MemoryChainRpcDefaultEndpointsPort implements ChainRpcDefaultEndpointsPort {
  #records = new Map<ChainRef, ChainRpcDefaultEndpointsRecord>();
  public readonly upserted: ChainRpcDefaultEndpointsRecord[] = [];
  public readonly removed: ChainRef[] = [];

  constructor(seed: ChainRpcDefaultEndpointsRecord[] = []) {
    for (const record of seed) {
      this.#records.set(record.chainRef, clone(record));
    }
  }

  async get(chainRef: ChainRef): Promise<ChainRpcDefaultEndpointsRecord | null> {
    const record = this.#records.get(chainRef);
    return record ? clone(record) : null;
  }

  async list(): Promise<ChainRpcDefaultEndpointsRecord[]> {
    return Array.from(this.#records.values(), (record) => clone(record));
  }

  async upsert(record: ChainRpcDefaultEndpointsRecord): Promise<void> {
    this.#records.set(record.chainRef, clone(record));
    this.upserted.push(clone(record));
  }

  async remove(chainRef: ChainRef): Promise<void> {
    this.#records.delete(chainRef);
    this.removed.push(chainRef);
  }

  async clear(): Promise<void> {
    this.#records.clear();
  }
}

export class MemoryVaultMetaPort implements VaultMetaPort {
  #vaultMeta: VaultMetaSnapshot | null;
  public savedVaultMeta: VaultMetaSnapshot | null = null;
  public clearedVaultMeta = false;

  constructor(seed: VaultMetaSnapshot | null = null) {
    this.#vaultMeta = seed ? clone(seed) : null;
  }

  async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    return this.#vaultMeta ? clone(this.#vaultMeta) : null;
  }

  async saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void> {
    this.#vaultMeta = clone(envelope);
    this.savedVaultMeta = clone(envelope);
  }

  async clearVaultMeta(): Promise<void> {
    this.#vaultMeta = null;
    this.clearedVaultMeta = true;
  }
}

export class MemoryChainDefinitionsPort implements ChainDefinitionsPort {
  #records = new Map<ChainRef, ChainDefinitionEntity>();
  public readonly putEntities: ChainDefinitionEntity[] = [];
  public readonly deleted: ChainRef[] = [];

  constructor(seed: ChainDefinitionEntity[] = []) {
    for (const record of seed) {
      this.#records.set(record.chainRef, clone(record));
    }
  }

  async get(chainRef: ChainRef): Promise<ChainDefinitionEntity | null> {
    const record = this.#records.get(chainRef);
    return record ? clone(record) : null;
  }

  async getAll(): Promise<ChainDefinitionEntity[]> {
    return Array.from(this.#records.values(), (record) => clone(record));
  }

  async put(entity: ChainDefinitionEntity): Promise<void> {
    this.#records.set(entity.chainRef, clone(entity));
    this.putEntities.push(clone(entity));
  }

  async putMany(entities: ChainDefinitionEntity[]): Promise<void> {
    for (const entity of entities) {
      await this.put(entity);
    }
  }

  async delete(chainRef: ChainRef): Promise<void> {
    this.#records.delete(chainRef);
    this.deleted.push(chainRef);
  }

  async clear(): Promise<void> {
    this.#records.clear();
  }
}

// Fake vault implementation for testing
export class FakeVault implements VaultService {
  #envelope: VaultEnvelope | null;
  #unlocked = false;
  #counter = 0;
  #password: string | null = null;
  #secret: Uint8Array | null = null;

  constructor(
    private readonly clock: () => number,
    initialEnvelope: VaultEnvelope | null = null,
  ) {
    this.#envelope = initialEnvelope ? structuredClone(initialEnvelope) : null;
  }

  private createEnvelope(): VaultEnvelope {
    void this.clock();
    this.#counter += 1;
    return {
      version: 1,
      kdf: {
        name: "pbkdf2",
        hash: "sha256",
        salt: "salt-base64",
        iterations: 1,
      },
      cipher: { name: "aes-gcm", iv: "iv-base64", data: `data-${this.#counter}` },
    };
  }

  async initialize(params: { password: string; secret: Uint8Array }): Promise<VaultEnvelope> {
    this.#password = params.password;
    this.#envelope = this.createEnvelope();
    this.#unlocked = false;
    this.#secret = new Uint8Array(params.secret);
    return structuredClone(this.#envelope);
  }

  async unlock(params: { password: string; envelope?: VaultEnvelope }): Promise<void> {
    if (!this.#password || params.password !== this.#password) {
      throw new VaultInvalidPasswordError();
    }

    if (params.envelope) {
      this.#envelope = structuredClone(params.envelope);
    } else if (!this.#envelope) {
      throw new VaultNotInitializedError();
    }

    this.#unlocked = true;
    if (!this.#secret) {
      // Initialize with empty keyrings payload that KeyringService expects
      const encoder = new TextEncoder();
      this.#secret = encoder.encode(JSON.stringify({ keyrings: [] }));
    }
  }

  lock(): void {
    this.#unlocked = false;
  }

  exportSecret(): Uint8Array {
    if (!this.#unlocked || !this.#secret) {
      throw new VaultLockedError();
    }
    return new Uint8Array(this.#secret);
  }

  verifyPassword(password: string): Promise<void> {
    if (!this.#password || password !== this.#password) {
      throw new VaultInvalidPasswordError();
    }
    return Promise.resolve();
  }

  async commitSecret(params: { secret: Uint8Array }): Promise<VaultEnvelope> {
    if (!this.#unlocked) throw new VaultLockedError();
    this.#envelope = this.createEnvelope();
    this.#secret = new Uint8Array(params.secret);
    return structuredClone(this.#envelope);
  }

  async reencrypt(params: { newPassword: string }): Promise<VaultEnvelope> {
    if (!this.#unlocked) throw new VaultLockedError();
    this.#password = params.newPassword;
    this.#envelope = this.createEnvelope();
    return structuredClone(this.#envelope);
  }

  loadEnvelope(value: VaultEnvelope): void {
    this.#envelope = structuredClone(value);
    this.#unlocked = false;
  }

  getEnvelope(): VaultEnvelope | null {
    return this.#envelope ? structuredClone(this.#envelope) : null;
  }

  getStatus() {
    if (this.#unlocked) return "unlocked" as const;
    if (this.#envelope) return "locked" as const;
    return "uninitialized" as const;
  }
}

// Test context type
export type TestBackgroundContext = {
  runtime: CreateBackgroundRuntimeResult;
  accountsPort: MemoryAccountsPort;
  keyringMetasPort: MemoryKeyringMetasPort;
  walletChainSelectionPort: MemoryWalletChainSelectionPort;
  providerChainSelectionPort: MemoryProviderChainSelectionPort;
  chainDefinitionsPort: MemoryChainDefinitionsPort;
  chainRpcDefaultEndpointsPort: MemoryChainRpcDefaultEndpointsPort;
  chainRpcEndpointOverridesPort: MemoryChainRpcEndpointOverridesPort;
  vaultMetaPort: MemoryVaultMetaPort;
  transactionAggregatesPort: MemoryTransactionAggregatesPort;
  destroy: () => void;
  enableAutoApproval: () => () => void; // Returns unsubscribe function
};

// Setup options type
export type SetupBackgroundOptions = {
  chainSeed?: TestChainSeedInput[];
  walletChainSelectionSeed?: WalletChainSelectionRecord | null;
  providerChainSelectionSeed?: ProviderChainSelectionRecord[];
  accountsSeed?: AccountRecord[];
  accountSelectionStateSeed?: AccountSelectionStateRecord | null;
  keyringMetasSeed?: KeyringMetaRecord[];
  accountsPort?: MemoryAccountsPort;
  keyringMetasPort?: MemoryKeyringMetasPort;
  vaultMetaPort?: MemoryVaultMetaPort;
  permissionsSeed?: PermissionRecord[];
  vaultMeta?: VaultMetaSnapshot | null;
  transactionAggregatesPort?: MemoryTransactionAggregatesPort;
  chainDefinitionsPort?: MemoryChainDefinitionsPort;
  autoLockDurationMs?: number;
  now?: () => number;
  timers?: RpcTimers;
  vault?: VaultService | (() => VaultService);
  persistDebounceMs?: number;
  transactions?: CreateBackgroundRuntimeOptions["transactions"];
  storageLogger?: (message: string, error: unknown) => void;
  rpcAccessPolicy?: CreateBackgroundRuntimeOptions["rpcAccessPolicy"];
};

/**
 * Sets up a complete background service environment for testing.
 * This function initializes runtime services, storage, and provides helpers
 * like auto-approval for streamlined test scenarios.
 */
export const setupBackground = async (options: SetupBackgroundOptions = {}): Promise<TestBackgroundContext> => {
  const chainSeed = options.chainSeed ?? [createChainDefinitionSeed()];
  const chainDefinitionsPort = options.chainDefinitionsPort ?? new MemoryChainDefinitionsPort();
  const walletChainSelectionPort = new MemoryWalletChainSelectionPort(options.walletChainSelectionSeed ?? null);
  const providerChainSelectionPort = new MemoryProviderChainSelectionPort(options.providerChainSelectionSeed ?? []);
  const chainRpcDefaultEndpointsPort = new MemoryChainRpcDefaultEndpointsPort();
  const chainRpcEndpointOverridesPort = new MemoryChainRpcEndpointOverridesPort();
  const vaultMetaPort = options.vaultMetaPort ?? new MemoryVaultMetaPort(options.vaultMeta ?? null);
  const permissionsPort = new MemoryPermissionsPort(options.permissionsSeed ?? []);
  const transactionAggregatesPort = options.transactionAggregatesPort ?? new MemoryTransactionAggregatesPort();
  const accountsPort =
    options.accountsPort ??
    new MemoryAccountsPort(options.accountsSeed ?? [], options.accountSelectionStateSeed ?? null);
  const keyringMetasPort = options.keyringMetasPort ?? new MemoryKeyringMetasPort(options.keyringMetasSeed ?? []);

  const storageOptions: NonNullable<CreateBackgroundRuntimeOptions["storage"]> = {
    vaultMetaPort,
    ...(options.now ? { now: options.now } : {}),
    ...(options.storageLogger ? { logger: options.storageLogger } : {}),
  };

  const needsSessionOptions =
    options.autoLockDurationMs !== undefined ||
    options.timers !== undefined ||
    options.vault !== undefined ||
    options.persistDebounceMs !== undefined;

  const sessionOptions: CreateBackgroundRuntimeOptions["session"] | undefined = needsSessionOptions
    ? {
        ...(options.autoLockDurationMs !== undefined ? { autoLockDurationMs: options.autoLockDurationMs } : {}),
        ...(options.timers ? { timers: options.timers } : {}),
        ...(options.vault ? { vault: options.vault } : {}),
        ...(options.persistDebounceMs !== undefined ? { persistDebounceMs: options.persistDebounceMs } : {}),
      }
    : undefined;

  const defaultRpcAccessPolicy: BackgroundRpcAccessPolicyHooks = {
    // Tests treat all origins as external; individual tests can override via options.rpcAccessPolicy.
    isInternalOrigin: () => false,
    shouldRequestUnlockAttention: () => false,
  };

  const runtime = createBackgroundRuntime({
    chainDefinitions: {
      seed: chainSeed.map(toChainDefinitionSeed),
    },
    namespaces: {
      manifests: TEST_NAMESPACE_MANIFESTS,
    },
    rpcAccessPolicy: options.rpcAccessPolicy ?? defaultRpcAccessPolicy,
    walletChainSelection: {
      port: walletChainSelectionPort,
    },
    providerChainSelection: {
      port: providerChainSelectionPort,
    },
    chainRpcDefaultEndpoints: {
      port: chainRpcDefaultEndpointsPort,
    },
    chainRpcEndpointOverrides: {
      port: chainRpcEndpointOverridesPort,
    },
    store: {
      ports: {
        chainDefinitions: chainDefinitionsPort,
        permissions: permissionsPort,
        transactionAggregates: transactionAggregatesPort,
        accounts: accountsPort,
        keyringMetas: keyringMetasPort,
      },
    },
    storage: storageOptions,
    ...(sessionOptions ? { session: sessionOptions } : {}),
    ...(options.transactions ? { transactions: options.transactions } : {}),
  });

  await runtime.lifecycle.initialize();
  runtime.lifecycle.start();

  // Helper function to enable auto-approval for testing
  const enableAutoApproval = () => {
    const pending = new Set<string>();

    const tryApprove = async (approvalId: string) => {
      const record = runtime.services.approvals.get(approvalId);
      if (record?.kind === ApprovalKinds.SendTransaction) {
        try {
          await runtime.services.approvals.resolve({
            approvalId,
            action: "approve",
          });
          pending.delete(approvalId);
        } catch {
          // Keep pending until the approval is resolved or disappears.
        }
        return;
      }

      pending.delete(approvalId);
    };

    const unsubscribe = runtime.services.approvals.onCreated(async ({ record }) => {
      pending.add(record.approvalId);
      await tryApprove(record.approvalId);
    });
    return () => {
      unsubscribe();
      pending.clear();
    };
  };

  return {
    runtime,
    accountsPort,
    keyringMetasPort,
    walletChainSelectionPort,
    providerChainSelectionPort,
    chainDefinitionsPort,
    chainRpcDefaultEndpointsPort,
    chainRpcEndpointOverridesPort,
    vaultMetaPort,
    transactionAggregatesPort,
    enableAutoApproval,
    destroy: () => {
      runtime.lifecycle.shutdown();
    },
  };
};

type RpcCallOptions = {
  method: string;
  params?: JsonRpcParams;
  origin?: string;
  rpcHint?: Partial<RpcInvocationHint>;
};

export type RpcHarness = TestBackgroundContext & {
  callRpc(options: RpcCallOptions): Promise<unknown>;
  origins: { internal: string; external: string };
};

export type RpcHarnessOptions = SetupBackgroundOptions & {
  internalOrigin?: string;
  externalOrigin?: string;
};

export const createRpcHarness = async (options: RpcHarnessOptions = {}): Promise<RpcHarness> => {
  const {
    internalOrigin = "chrome-extension://arx",
    externalOrigin = "https://dapp.example",
    ...setupOptions
  } = options;
  const clock = setupOptions.now ?? Date.now;
  const background = await setupBackground({
    ...setupOptions,
    rpcAccessPolicy:
      setupOptions.rpcAccessPolicy ??
      ({
        isInternalOrigin: (origin) => origin === internalOrigin,
        shouldRequestUnlockAttention: () => false,
      } as const),
    ...(setupOptions.vault === undefined ? { vault: () => new FakeVault(clock) } : {}),
  });
  const { runtime } = background;

  const deriveMethodNamespace = runtime.rpc.resolveMethodNamespace;

  const buildRpcHint = (overrides?: Partial<RpcInvocationHint>): RpcInvocationHint => {
    const chain = requireActiveChainDefinition(runtime);
    const namespace = overrides?.namespace ?? getChainRefNamespace(chain.chainRef);
    const chainRef = overrides?.chainRef ?? chain.chainRef;

    return {
      namespace,
      chainRef,
    };
  };

  let nextRequestId = 0;
  const sessionId = crypto.randomUUID();
  const portId = "test-port";
  const callRpc = async ({ method, params, origin = externalOrigin, rpcHint }: RpcCallOptions) => {
    const requestId = `${++nextRequestId}`;
    const hintPayload = buildRpcHint(rpcHint);
    const namespace = deriveMethodNamespace(method, hintPayload);
    const requestNamespace = namespace ?? hintPayload.namespace ?? "eip155";

    if (origin !== internalOrigin) {
      await runtime.providerAccess.activateConnectionScope({
        origin,
        namespace: requestNamespace,
      });
    }

    const response = await runtime.providerAccess.request({
      scope: {
        transport: "provider",
        origin,
        portId,
        sessionId,
      },
      namespace: requestNamespace,
      request: {
        id: requestId,
        jsonrpc: "2.0",
        method,
        ...(params !== undefined ? { params } : {}),
      },
    });

    if ("error" in response) {
      throw response.error;
    }

    return response.result;
  };

  return {
    ...background,
    callRpc,
    origins: { internal: internalOrigin, external: externalOrigin },
  };
};
