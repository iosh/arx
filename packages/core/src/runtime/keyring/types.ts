import type { UnlockController } from "../../controllers/unlock/types.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import type { VaultKeyringEntry } from "../../storage/keyringSchemas.js";
import type { AccountKey, AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import type { VaultService } from "../../vault/types.js";
import type { KeyringKind, NamespaceConfig } from "./namespaces.js";

// Service dependencies
export type KeyringServiceOptions = {
  now: () => number;
  uuid: () => string;
  vault: Pick<VaultService, "exportSecret" | "isUnlocked" | "verifyPassword">;
  unlock: Pick<UnlockController, "onUnlocked" | "onLocked" | "isUnlocked">;
  keyringMetas: {
    get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null>;
    list(): Promise<KeyringMetaRecord[]>;
    upsert(record: KeyringMetaRecord): Promise<void>;
    remove(id: KeyringMetaRecord["id"]): Promise<void>;
  };
  accountsStore: {
    get(accountKey: AccountKey): Promise<AccountRecord | null>;
    list(params?: { includeHidden?: boolean }): Promise<AccountRecord[]>;
    upsert(record: AccountRecord): Promise<void>;
    remove(accountKey: AccountKey): Promise<void>;
    removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void>;
  };
  namespaces: NamespaceConfig[];
  logger?: (message: string, error?: unknown) => void;
  // Called when vault unlock succeeds but persisted runtime keyrings cannot be fully materialized.
  // Callers can fail closed here, for example by relocking the session.
  onHydrationError?: (error: unknown) => void | Promise<void>;
};

// Runtime keyring with instance
export type RuntimeKeyring = {
  id: string;
  kind: KeyringKind;
  namespace: string;
  instance: HierarchicalDeterministicKeyring | SimpleKeyring;
};

// Vault payload structure
export type Payload = { keyrings: VaultKeyringEntry[] };

export type KeyringPayloadListener = (payload: Uint8Array | null) => void | Promise<void>;

export type RuntimeAccountRef = {
  namespace: string;
  keyringId: string;
  accountKey: AccountKey;
};

// Centralized runtime state
export type KeyringRuntimeState = {
  keyrings: Map<string, RuntimeKeyring>;
  keyringMetas: Map<string, KeyringMetaRecord>;
  accounts: Map<AccountKey, AccountRecord>;
  payload: Payload;
  addressIndex: Map<AccountKey, RuntimeAccountRef>;
  payloadListeners: Set<KeyringPayloadListener>;
};

export type { AccountKey, AccountRecord, KeyringMetaRecord, VaultKeyringEntry };
