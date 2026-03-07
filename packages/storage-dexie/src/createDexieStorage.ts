import type {
  AccountsPort,
  ChainDefinitionsPort,
  KeyringMetasPort,
  NetworkPreferencesPort,
  PermissionsPort,
  SettingsPort,
  TransactionsPort,
} from "@arx/core/services";
import type { VaultMetaPort } from "@arx/core/storage";

import { ArxStorageDatabase } from "./db.js";
import { createDexieCtx, type DexieCtx, type StorageDexieLogger } from "./internal/ctx.js";
import { DexieAccountsPort } from "./ports/accountsPort.js";
import { DexieChainDefinitionsPort } from "./ports/chainDefinitionsPort.js";
import { DexieKeyringMetasPort } from "./ports/keyringMetasPort.js";
import { DexieNetworkPreferencesPort } from "./ports/networkPreferencesPort.js";
import { DexiePermissionsPort } from "./ports/permissionsPort.js";
import { DexieSettingsPort } from "./ports/settingsPort.js";
import { DexieTransactionsPort } from "./ports/transactionsPort.js";
import { DexieVaultMetaPort } from "./ports/vaultMetaPort.js";
import { DEFAULT_DB_NAME, getOrCreateDatabase } from "./sharedDb.js";

export type DexieStoragePorts = {
  settings: SettingsPort;
  chainDefinitions: ChainDefinitionsPort;
  networkPreferences: NetworkPreferencesPort;
  vaultMeta: VaultMetaPort;

  accounts: AccountsPort;
  permissions: PermissionsPort;
  keyringMetas: KeyringMetasPort;
  transactions: TransactionsPort;
};

export type DexieStorage = {
  ports: DexieStoragePorts;
  /**
   * Internal escape hatch for tests and debugging.
   * Avoid using this in app code; the underlying Dexie instance is shared per databaseName.
   */
  __debug: {
    db: ArxStorageDatabase;
    ctx: DexieCtx;
  };
};

export type CreateDexieStorageOptions = {
  databaseName?: string;
  logger?: StorageDexieLogger;
};

export const createDexieStorage = (options: CreateDexieStorageOptions = {}): DexieStorage => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  const db = getOrCreateDatabase(dbName, (name) => new ArxStorageDatabase(name));

  const logger: StorageDexieLogger = options.logger ?? { warn: console.warn.bind(console) };
  const ctx = createDexieCtx(db, logger);

  return {
    ports: {
      settings: new DexieSettingsPort(ctx),
      chainDefinitions: new DexieChainDefinitionsPort(ctx),
      networkPreferences: new DexieNetworkPreferencesPort(ctx),
      vaultMeta: new DexieVaultMetaPort(ctx),

      accounts: new DexieAccountsPort(ctx),
      permissions: new DexiePermissionsPort(ctx),
      keyringMetas: new DexieKeyringMetasPort(ctx),
      transactions: new DexieTransactionsPort(ctx),
    },
    __debug: { db, ctx },
  };
};
