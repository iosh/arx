import { accountSelectionWrites, accountWrites } from "../accounts/persistence.js";
import { dappNetworkSelectionWrites } from "../dappConnections/persistence.js";
import { hdKeyringWrites, keySourceWrites } from "../keyring/persistence.js";
import { customNetworkWrites, networkRpcOverrideWrites, networkSelectionWrites } from "../networks/persistence.js";
import { permissionWrites } from "../permissions/persistence.js";
import { settingWrites } from "../settings/persistence.js";
import { transactionWrites } from "../transactions/persistence.js";
import { encryptedVaultWrites } from "../vault/persistence.js";
import type { PersistenceChangeOf } from "./change.js";

export type PersistenceTypes = Readonly<{
  encryptedVault: typeof encryptedVaultWrites;
  setting: typeof settingWrites;
  keySource: typeof keySourceWrites;
  hdKeyring: typeof hdKeyringWrites;
  account: typeof accountWrites;
  accountSelection: typeof accountSelectionWrites;
  permission: typeof permissionWrites;
  customNetwork: typeof customNetworkWrites;
  networkRpcOverride: typeof networkRpcOverrideWrites;
  networkSelection: typeof networkSelectionWrites;
  dappNetworkSelection: typeof dappNetworkSelectionWrites;
  transaction: typeof transactionWrites;
}>;

export const persistenceTypes: PersistenceTypes = {
  encryptedVault: encryptedVaultWrites,
  setting: settingWrites,
  keySource: keySourceWrites,
  hdKeyring: hdKeyringWrites,
  account: accountWrites,
  accountSelection: accountSelectionWrites,
  permission: permissionWrites,
  customNetwork: customNetworkWrites,
  networkRpcOverride: networkRpcOverrideWrites,
  networkSelection: networkSelectionWrites,
  dappNetworkSelection: dappNetworkSelectionWrites,
  transaction: transactionWrites,
};

export type PersistenceType = PersistenceTypes[keyof PersistenceTypes];
export type PersistenceChange = PersistenceChangeOf<PersistenceType>;
