import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import type { UnlockService } from "../../runtime/session/unlock/types.js";
import type { VaultKeyringEntry } from "../../storage/keyringSchemas.js";
import type { AccountId, AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import type { VaultService } from "../../vault/types.js";
import type { KeyringKind, NamespaceConfig } from "./namespaces.js";

// Service dependencies
export type KeyringServiceOptions = {
  now: () => number;
  uuid: () => string;
  vault: Pick<VaultService, "exportSecret" | "getStatus" | "verifyPassword">;
  unlock: Pick<UnlockService, "onUnlocked" | "onLocked" | "isUnlocked">;
  keyringMetas: {
    get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null>;
    list(): Promise<KeyringMetaRecord[]>;
    upsert(record: KeyringMetaRecord): Promise<void>;
    remove(id: KeyringMetaRecord["id"]): Promise<void>;
  };
  accountsStore: {
    get(accountId: AccountId): Promise<AccountRecord | null>;
    list(params?: { includeHidden?: boolean }): Promise<AccountRecord[]>;
    upsert(record: AccountRecord): Promise<void>;
    remove(accountId: AccountId): Promise<void>;
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
export type KeyringStateListener = () => void;

export type RuntimeAccountRef = {
  namespace: string;
  keyringId: string;
  accountId: AccountId;
};

export type InitialKeyringDraftBase = {
  keyringId: string;
  kind: KeyringKind;
  namespace: string;
  meta: KeyringMetaRecord;
  accounts: AccountRecord[];
  payloadEntry: VaultKeyringEntry;
};

export type InitialHdKeyringDraft = InitialKeyringDraftBase & {
  kind: "hd";
  instance: HierarchicalDeterministicKeyring;
  defaultAccountAddress: string;
};

export type InitialPrivateKeyKeyringDraft = InitialKeyringDraftBase & {
  kind: "private-key";
  instance: SimpleKeyring;
  defaultAccountAddress: string;
};

// Centralized runtime state
export type KeyringRuntimeState = {
  keyrings: Map<string, RuntimeKeyring>;
  keyringMetas: Map<string, KeyringMetaRecord>;
  accounts: Map<AccountId, AccountRecord>;
  payload: Payload;
  addressIndex: Map<AccountId, RuntimeAccountRef>;
  payloadListeners: Set<KeyringPayloadListener>;
};

export type { AccountId, AccountRecord, KeyringMetaRecord, VaultKeyringEntry };
