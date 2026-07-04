import { z } from "zod";
import type { RpcEndpoint } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { KeyringType } from "./keyringSchemas.js";

export type AccountNamespace = string;

// External input parser for account keys. Storage records themselves are typed
// values and are not runtime-validated through zod.
export const AccountIdSchema = z.string().regex(/^[a-z0-9]+:(?:[0-9a-f]{2})+$/, {
  error: "accountId must be <namespace>:<even-length lowercase hex bytes>",
});
export type AccountId = string;

export type SettingsRecord = {
  id: "settings";
  selectedAccountIdsByNamespace?: Record<string, AccountId> | undefined;
  updatedAt: number;
};

export type ChainRpcEndpointOverrideRecord = {
  chainRef: ChainRef;
  rpcEndpoints: RpcEndpoint[];
  updatedAt: number;
};

export type ChainRpcDefaultEndpointsRecord = {
  chainRef: ChainRef;
  rpcEndpoints: RpcEndpoint[];
  source: "bundle" | "request";
  updatedAt: number;
};

export type WalletChainSelectionRecord = {
  id: "wallet-chain-selection";
  selectedNamespace: string;
  chainRefByNamespace: Record<string, ChainRef>;
  updatedAt: number;
};

export type ProviderChainSelectionRecord = {
  origin: string;
  namespace: string;
  chainRef: ChainRef;
  updatedAt: number;
};

export type KeyringMetaRecord = {
  id: string;
  type: KeyringType;
  alias?: string | undefined;
  needsBackup?: boolean | undefined;
  // HD only: the next derivation index to use (monotonic, even if accounts are removed/hidden).
  nextDerivationIndex?: number | undefined;
  createdAt: number;
};

export type AccountRecord = {
  accountId: AccountId;
  namespace: AccountNamespace;
  keyringId: string;
  derivationIndex?: number | undefined;
  alias?: string | undefined;
  hidden?: boolean | undefined;
  createdAt: number;
};

// Empty means the origin is connected to the chain but has no account access on it.
export type PermissionChainAccountIds = AccountId[];
export type PermissionChainScopes = Record<ChainRef, PermissionChainAccountIds>;

export type PermissionRecord = {
  origin: string;
  namespace: string;
  // One persistent connection-authorization record per (origin, namespace).
  // Request-level signing and transaction approvals remain runtime state.
  chainScopes: PermissionChainScopes;
};
