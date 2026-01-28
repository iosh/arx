import type { AccountsPort, ApprovalsPort, KeyringMetasPort, PermissionsPort } from "@arx/core/services";

import { DEFAULT_DB_NAME, getOrCreateDatabase } from "../sharedDb.js";
import { ArxStorageDatabase } from "../db.js";
import { DexieAccountsPort } from "./accountsPort.js";
import { DexieApprovalsPort } from "./approvalsPort.js";
import { DexieKeyringMetasPort } from "./keyringMetasPort.js";
import { DexiePermissionsPort } from "./permissionsPort.js";

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
