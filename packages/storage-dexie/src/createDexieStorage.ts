import type { CoreStoragePorts } from "@arx/core/engine";

import { ArxStorageDatabase } from "./db.js";
import { createDexieCtx, type DexieCtx, type StorageDexieLogger } from "./internal/ctx.js";
import { DexieAccountsPort } from "./ports/accountsPort.js";
import { DexieCustomChainsPort } from "./ports/customChainsPort.js";
import { DexieCustomRpcPort } from "./ports/customRpcPort.js";
import { DexieKeyringMetasPort } from "./ports/keyringMetasPort.js";
import { DexiePermissionsPort } from "./ports/permissionsPort.js";
import { DexieProviderChainSelectionPort } from "./ports/providerChainSelectionPort.js";
import { DexieSettingsPort } from "./ports/settingsPort.js";
import { DexieTransactionAggregatesPort } from "./ports/transactionAggregatesPort.js";
import { DexieVaultMetaPort } from "./ports/vaultMetaPort.js";
import { DexieWalletChainSelectionPort } from "./ports/walletChainSelectionPort.js";

export const DEFAULT_DEXIE_DATABASE_NAME = "arx-storage";

export type DexieStoragePorts = CoreStoragePorts;

export type DexieStorage = {
  ports: DexieStoragePorts;
  close(): void;
  /**
   * Internal escape hatch for tests and debugging.
   * Avoid using this in app code.
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
  const dbName = options.databaseName ?? DEFAULT_DEXIE_DATABASE_NAME;
  const db = new ArxStorageDatabase(dbName);

  const logger: StorageDexieLogger = options.logger ?? { warn: console.warn.bind(console) };
  const ctx = createDexieCtx(db, logger);

  return {
    ports: {
      vault: new DexieVaultMetaPort(ctx),
      keyrings: new DexieKeyringMetasPort(ctx),
      accounts: new DexieAccountsPort(ctx),
      permissions: new DexiePermissionsPort(ctx),
      chains: {
        customChains: new DexieCustomChainsPort(ctx),
        customRpc: new DexieCustomRpcPort(ctx),
        walletChainSelection: new DexieWalletChainSelectionPort(ctx),
        providerChainSelection: new DexieProviderChainSelectionPort(ctx),
      },
      transactions: new DexieTransactionAggregatesPort(ctx),
      settings: new DexieSettingsPort(ctx),
    },
    close: () => db.close(),
    __debug: { db, ctx },
  };
};
