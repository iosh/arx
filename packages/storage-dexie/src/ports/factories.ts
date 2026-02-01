import type {
  AccountsPort,
  ApprovalsPort,
  KeyringMetasPort,
  PermissionsPort,
  TransactionsPort,
} from "@arx/core/services";
import type { NetworkRpcPort, VaultMetaPort } from "@arx/core/storage";
import { ArxStorageDatabase } from "../db.js";
import { DEFAULT_DB_NAME, getOrCreateDatabase } from "../sharedDb.js";
import { DexieAccountsPort } from "./accountsPort.js";
import { DexieApprovalsPort } from "./approvalsPort.js";
import { DexieKeyringMetasPort } from "./keyringMetasPort.js";
import { DexieNetworkRpcPort } from "./networkRpcPort.js";
import { DexiePermissionsPort } from "./permissionsPort.js";
import { DexieTransactionsPort } from "./transactionsPort.js";
import { DexieVaultMetaPort } from "./vaultMetaPort.js";

const getDb = (dbName: string) => getOrCreateDatabase(dbName, (name) => new ArxStorageDatabase(name));

export type CreateDexieApprovalsPortOptions = { databaseName?: string };
export const createDexieApprovalsPort = (options: CreateDexieApprovalsPortOptions = {}): ApprovalsPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  return new DexieApprovalsPort(getDb(dbName));
};

export type CreateDexiePermissionsPortOptions = { databaseName?: string };
export const createDexiePermissionsPort = (options: CreateDexiePermissionsPortOptions = {}): PermissionsPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  return new DexiePermissionsPort(getDb(dbName));
};

export type CreateDexieAccountsPortOptions = { databaseName?: string };
export const createDexieAccountsPort = (options: CreateDexieAccountsPortOptions = {}): AccountsPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  return new DexieAccountsPort(getDb(dbName));
};

export type CreateDexieKeyringMetasPortOptions = { databaseName?: string };
export const createDexieKeyringMetasPort = (options: CreateDexieKeyringMetasPortOptions = {}): KeyringMetasPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  return new DexieKeyringMetasPort(getDb(dbName));
};

export type CreateDexieTransactionsPortOptions = { databaseName?: string };
export const createDexieTransactionsPort = (options: CreateDexieTransactionsPortOptions = {}): TransactionsPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  return new DexieTransactionsPort(getDb(dbName));
};

export type CreateDexieNetworkRpcPortOptions = { databaseName?: string };
export const createDexieNetworkRpcPort = (options: CreateDexieNetworkRpcPortOptions = {}): NetworkRpcPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  return new DexieNetworkRpcPort(getDb(dbName));
};

export type CreateDexieVaultMetaPortOptions = { databaseName?: string };
export const createDexieVaultMetaPort = (options: CreateDexieVaultMetaPortOptions = {}): VaultMetaPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  return new DexieVaultMetaPort(getDb(dbName));
};
