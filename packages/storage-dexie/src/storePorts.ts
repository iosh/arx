import {
  createDexieAccountsPort,
  createDexieKeyringMetasPort,
  createDexiePermissionsPort,
  createDexieTransactionsPort,
} from "./ports/factories.js";
export type CreateDexieStorePortsOptions = {
  databaseName?: string;
};

export const createDexieStorePorts = (options: CreateDexieStorePortsOptions = {}) => {
  const { databaseName } = options;

  const permissions = createDexiePermissionsPort({ ...(databaseName ? { databaseName } : {}) });
  const accounts = createDexieAccountsPort({ ...(databaseName ? { databaseName } : {}) });
  const keyringMetas = createDexieKeyringMetasPort({ ...(databaseName ? { databaseName } : {}) });
  const transactions = createDexieTransactionsPort({ ...(databaseName ? { databaseName } : {}) });

  return { permissions, accounts, keyringMetas, transactions };
};
