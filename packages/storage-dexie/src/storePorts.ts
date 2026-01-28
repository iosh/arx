import {
  createDexieAccountsPort,
  createDexieApprovalsPort,
  createDexieKeyringMetasPort,
  createDexiePermissionsPort,
} from "./ports/factories.js";
export type CreateDexieStorePortsOptions = {
  databaseName?: string;
};

export const createDexieStorePorts = (options: CreateDexieStorePortsOptions = {}) => {
  const { databaseName } = options;

  const approvals = createDexieApprovalsPort({ ...(databaseName ? { databaseName } : {}) });
  const permissions = createDexiePermissionsPort({ ...(databaseName ? { databaseName } : {}) });
  const accounts = createDexieAccountsPort({ ...(databaseName ? { databaseName } : {}) });
  const keyringMetas = createDexieKeyringMetasPort({ ...(databaseName ? { databaseName } : {}) });

  return { approvals, permissions, accounts, keyringMetas };
};
