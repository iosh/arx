import type { CorePersistence } from "@arx/core/persistence";
import { createDexiePersistenceContext } from "./database.js";
import { createAccountsReader } from "./readers/accounts.js";
import { createDappNetworkSelectionsReader } from "./readers/dappConnections.js";
import { createHdKeyringsReader, createKeySourcesReader } from "./readers/keyrings.js";
import {
  createCustomNetworksReader,
  createNetworkRpcOverridesReader,
  createNetworkSelectionReader,
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
      customNetworks: createCustomNetworksReader(context),
      networkRpcOverrides: createNetworkRpcOverridesReader(context),
      networkSelection: createNetworkSelectionReader(context),
      dappNetworkSelections: createDappNetworkSelectionsReader(context),
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
