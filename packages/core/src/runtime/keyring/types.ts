import type {
  AccountController,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
} from "../../controllers/account/types.js";
import type { UnlockController } from "../../controllers/unlock/types.js";
import type { KeyringKind, NamespaceConfig } from "../../keyring/namespace.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import type { AccountMeta, KeyringMeta, VaultKeyringEntry } from "../../storage/keyringSchemas.js";
import type { KeyringStorePort } from "../../storage/keyringStore.js";
import type { VaultService } from "../../vault/types.js";

// Service dependencies
export type KeyringServiceOptions = {
  vault: Pick<VaultService, "exportKey" | "isUnlocked" | "verifyPassword">;
  unlock: Pick<UnlockController, "onUnlocked" | "onLocked" | "isUnlocked">;
  accounts: Pick<AccountController, "getState" | "replaceState">;
  keyringStore: KeyringStorePort;
  namespaces: NamespaceConfig[];
  logger?: (message: string, error?: unknown) => void;
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

// Centralized runtime state
export type KeyringRuntimeState = {
  keyrings: Map<string, RuntimeKeyring>;
  keyringMetas: Map<string, KeyringMeta>;
  accountMetas: Map<string, AccountMeta>;
  payload: Payload;
  addressIndex: Map<string, { namespace: string; keyringId: string }>;
  payloadListeners: Set<(payload: Uint8Array | null) => void>;
};

export type { AccountMeta, KeyringMeta, VaultKeyringEntry };
export type { MultiNamespaceAccountsState, NamespaceAccountsState };
