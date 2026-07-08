import type { CoreStoragePorts } from "@arx/core/engine";

import { ArxStorageDatabase } from "./db.js";
import { createDexieCtx, type DexieCtx } from "./internal/ctx.js";
import { DexieAccountsPort } from "./ports/accountsPort.js";
import { DexieChainDefinitionsPort } from "./ports/chainDefinitionsPort.js";
import { DexieChainRpcDefaultEndpointsPort } from "./ports/chainRpcDefaultEndpointsPort.js";
import { DexieChainRpcEndpointOverridesPort } from "./ports/chainRpcEndpointOverridesPort.js";
import { DexieKeyringMetasPort } from "./ports/keyringMetasPort.js";
import { DexiePermissionsPort } from "./ports/permissionsPort.js";
import { DexieProviderChainSelectionPort } from "./ports/providerChainSelectionPort.js";
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
};

export const createDexieStorage = (options: CreateDexieStorageOptions = {}): DexieStorage => {
  const dbName = options.databaseName ?? DEFAULT_DEXIE_DATABASE_NAME;
  const db = new ArxStorageDatabase(dbName);
  const ctx = createDexieCtx(db);

  return {
    ports: {
      vault: new DexieVaultMetaPort(ctx),
      keyrings: new DexieKeyringMetasPort(ctx),
      accounts: new DexieAccountsPort(ctx),
      permissions: new DexiePermissionsPort(ctx),
      chains: {
        chainDefinitions: new DexieChainDefinitionsPort(ctx),
        chainRpcDefaultEndpoints: new DexieChainRpcDefaultEndpointsPort(ctx),
        chainRpcEndpointOverrides: new DexieChainRpcEndpointOverridesPort(ctx),
        walletChainSelection: new DexieWalletChainSelectionPort(ctx),
        providerChainSelection: new DexieProviderChainSelectionPort(ctx),
      },
      transactions: new DexieTransactionAggregatesPort(ctx),
    },
    close: () => db.close(),
    __debug: { db, ctx },
  };
};
