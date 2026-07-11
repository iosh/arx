import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { customChainPersistenceType } from "../chains/definitions/persistence.js";
import { chainRpcOverridePersistenceType } from "../chains/rpc/endpointOverrides/persistence.js";
import { providerChainSelectionPersistenceType } from "../chains/selection/provider/persistence.js";
import { walletChainSelectionPersistenceType } from "../chains/selection/wallet/persistence.js";
import { hdKeyringPersistenceType, keySourcePersistenceType } from "../keyring/persistence.js";
import { permissionPersistenceType } from "../permissions/persistence.js";
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
  customChain: typeof customChainPersistenceType;
  chainRpcOverride: typeof chainRpcOverridePersistenceType;
  walletChainSelection: typeof walletChainSelectionPersistenceType;
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
  customChain: customChainPersistenceType,
  chainRpcOverride: chainRpcOverridePersistenceType,
  walletChainSelection: walletChainSelectionPersistenceType,
  providerChainSelection: providerChainSelectionPersistenceType,
  transaction: transactionPersistenceType,
};

export type PersistenceType = PersistenceTypes[keyof PersistenceTypes];
export type PersistenceChange = PersistenceChangeOf<PersistenceType>;
