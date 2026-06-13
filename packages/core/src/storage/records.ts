import { z } from "zod";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata, RpcEndpoint } from "../chains/metadata.js";
import type { KeyringType } from "./keyringSchemas.js";
import type { RpcStrategy } from "./schemas/rpc.js";

export type AccountNamespace = string;

// External input parser for account keys. Storage records themselves are typed
// values and are not runtime-validated through zod.
export const AccountKeySchema = z.string().regex(/^[a-z0-9]+:(?:[0-9a-f]{2})+$/, {
  error: "accountKey must be <namespace>:<even-length lowercase hex bytes>",
});
export type AccountKey = string;

export type SettingsRecord = {
  id: "settings";
  selectedAccountKeysByNamespace?: Record<string, AccountKey> | undefined;
  updatedAt: number;
};

export type NetworkRpcPreference = {
  activeIndex: number;
  strategy: RpcStrategy;
};

export type CustomChainRecord = {
  chainRef: ChainRef;
  namespace: string;
  metadata: ChainMetadata;
  createdByOrigin?: string | undefined;
  updatedAt: number;
};

export type CustomRpcRecord = {
  chainRef: ChainRef;
  rpcEndpoints: RpcEndpoint[];
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

export type NetworkPreferencesRecord = {
  id: "network-preferences";
  selectedNamespace: string;
  activeChainByNamespace: Record<string, ChainRef>;
  rpc: Record<ChainRef, NetworkRpcPreference>;
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
  accountKey: AccountKey;
  namespace: AccountNamespace;
  keyringId: string;
  derivationIndex?: number | undefined;
  alias?: string | undefined;
  hidden?: boolean | undefined;
  createdAt: number;
};

// Empty means the origin is connected to the chain but has no account access on it.
export type PermissionChainAccountKeys = AccountKey[];
export type PermissionChainScopes = Record<ChainRef, PermissionChainAccountKeys>;

export type PermissionRecord = {
  origin: string;
  namespace: string;
  // One persistent connection-authorization record per (origin, namespace).
  // Request-level signing and transaction approvals remain runtime state.
  chainScopes: PermissionChainScopes;
};
