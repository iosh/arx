import type { CorePersistence } from "@arx/core/persistence";
import { createDexiePersistenceContext } from "./database.js";
import { createAccountsReader } from "./readers/accounts.js";
import { createHdKeyringsReader, createKeySourcesReader } from "./readers/keyrings.js";
import {
  createChainRpcOverridesReader,
  createCustomChainsReader,
  createProviderChainSelectionsReader,
  createWalletChainSelectionReader,
} from "./readers/network.js";
import { createPermissionsReader } from "./readers/permissions.js";
import { createSettingsReader } from "./readers/settings.js";
import { createTransactionsReader } from "./readers/transactions.js";
import { createEncryptedVaultReader } from "./readers/vault.js";
import { createPersistenceWriter } from "./writer.js";

export type CreateDexiePersistenceOptions = Readonly<{
  databaseName: string;
}>;

export type DexiePersistence = CorePersistence & {
  close(): Promise<void>;
};

export const createDexiePersistence = (options: CreateDexiePersistenceOptions): DexiePersistence => {
  const context = createDexiePersistenceContext(options.databaseName);

  return {
    readers: {
      encryptedVault: createEncryptedVaultReader(context),
      settings: createSettingsReader(context),
      keySources: createKeySourcesReader(context),
      hdKeyrings: createHdKeyringsReader(context),
      accounts: createAccountsReader(context),
      permissions: createPermissionsReader(context),
      customChains: createCustomChainsReader(context),
      chainRpcOverrides: createChainRpcOverridesReader(context),
      walletChainSelection: createWalletChainSelectionReader(context),
      providerChainSelections: createProviderChainSelectionsReader(context),
      transactions: createTransactionsReader(context),
    },
    writer: createPersistenceWriter(context),
    async close() {
      try {
        await context.ready;
      } finally {
        context.db.close();
      }
    },
  };
};
