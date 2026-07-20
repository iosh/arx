import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { hdKeyringPersistenceType, keySourcePersistenceType } from "../keyring/persistence.js";
import {
  customNetworkPersistenceType,
  networkRpcOverridePersistenceType,
  networkSelectionPersistenceType,
} from "../networks/persistence.js";
import { permissionPersistenceType } from "../permissions/persistence.js";
import { providerChainSelectionPersistenceType } from "../provider/persistence.js";
import { settingPersistenceType } from "../settings/persistence.js";
import { transactionPersistenceType } from "../transactions/persistence.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import type { PersistenceChangeOf } from "./change.js";

export type PersistenceTypes = Readonly<{
  encryptedVault: typeof encryptedVaultPersistenceType;
  setting: typeof settingPersistenceType;
  keySource: typeof keySourcePersistenceType;
  hdKeyring: typeof hdKeyringPersistenceType;
  account: typeof accountPersistenceType;
  accountSelection: typeof accountSelectionPersistenceType;
  permission: typeof permissionPersistenceType;
  customNetwork: typeof customNetworkPersistenceType;
  networkRpcOverride: typeof networkRpcOverridePersistenceType;
  networkSelection: typeof networkSelectionPersistenceType;
  providerChainSelection: typeof providerChainSelectionPersistenceType;
  transaction: typeof transactionPersistenceType;
}>;

export const persistenceTypes: PersistenceTypes = {
  encryptedVault: encryptedVaultPersistenceType,
  setting: settingPersistenceType,
  keySource: keySourcePersistenceType,
  hdKeyring: hdKeyringPersistenceType,
  account: accountPersistenceType,
  accountSelection: accountSelectionPersistenceType,
  permission: permissionPersistenceType,
  customNetwork: customNetworkPersistenceType,
  networkRpcOverride: networkRpcOverridePersistenceType,
  networkSelection: networkSelectionPersistenceType,
  providerChainSelection: providerChainSelectionPersistenceType,
  transaction: transactionPersistenceType,
};

export type PersistenceType = PersistenceTypes[keyof PersistenceTypes];
export type PersistenceChange = PersistenceChangeOf<PersistenceType>;
