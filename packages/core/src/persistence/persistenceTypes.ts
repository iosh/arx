import { accountGroupWrites, accountSelectionWrites } from "../accounts/persistence.js";
import { dappNetworkSelectionWrites } from "../dappConnections/persistence.js";
import { keySourceWrites } from "../keyring/persistence.js";
import { customNetworkWrites, networkRpcOverrideWrites } from "../networks/persistence.js";
import { permissionWrites } from "../permissions/persistence.js";
import { settingWrites } from "../settings/persistence.js";
import { transactionWrites } from "../transactions/persistence.js";
import { encryptedVaultWrites } from "../vault/persistence.js";
import type { PersistenceChangeOf } from "./change.js";

export type PersistenceTypes = Readonly<{
  encryptedVault: typeof encryptedVaultWrites;
  setting: typeof settingWrites;
  keySource: typeof keySourceWrites;
  accountGroup: typeof accountGroupWrites;
  accountSelection: typeof accountSelectionWrites;
  permission: typeof permissionWrites;
  customNetwork: typeof customNetworkWrites;
  networkRpcOverride: typeof networkRpcOverrideWrites;
  dappNetworkSelection: typeof dappNetworkSelectionWrites;
  transaction: typeof transactionWrites;
}>;

export const persistenceTypes: PersistenceTypes = {
  encryptedVault: encryptedVaultWrites,
  setting: settingWrites,
  keySource: keySourceWrites,
  accountGroup: accountGroupWrites,
  accountSelection: accountSelectionWrites,
  permission: permissionWrites,
  customNetwork: customNetworkWrites,
  networkRpcOverride: networkRpcOverrideWrites,
  dappNetworkSelection: dappNetworkSelectionWrites,
  transaction: transactionWrites,
};

export type PersistenceType = PersistenceTypes[keyof PersistenceTypes];
export type PersistenceChange = PersistenceChangeOf<PersistenceType>;
