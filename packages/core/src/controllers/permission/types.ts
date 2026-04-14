import type { ChainRef } from "../../chains/ids.js";
import { ConnectionGrantKinds } from "../../permissions/connectionGrantKinds.js";
import type { AccountKey } from "../../storage/records.js";
import type { ChainNamespace } from "../account/types.js";

export { ConnectionGrantKinds };
export type ConnectionGrantKind = (typeof ConnectionGrantKinds)[keyof typeof ConnectionGrantKinds];

export type ChainPermissionState = {
  accountKeys: AccountKey[];
};

export type NamespacePermissionState = {
  chains: Record<ChainRef, ChainPermissionState>;
};

export type OriginPermissionState = Record<ChainNamespace, NamespacePermissionState>;

export type OriginPermissions = {
  origin: string;
  namespaces: OriginPermissionState;
};

export type PermissionsState = {
  origins: Record<string, OriginPermissionState>;
};

/**
 * Persistent connection authorization for one origin and namespace.
 *
 * The record defines the permitted chain and account scope only. Request-level
 * signing and transaction approvals are not represented here.
 */
export type PermissionAuthorization = {
  origin: string;
  namespace: ChainNamespace;
  chains: Record<ChainRef, ChainPermissionState>;
};

export type ChainPermissionAuthorization = {
  origin: string;
  namespace: ChainNamespace;
  chainRef: ChainRef;
  accountKeys: AccountKey[];
};

export type AuthorizationChainInput = {
  chainRef: ChainRef;
  accountKeys: AccountKey[];
};

export type GrantAuthorizationOptions = {
  namespace: ChainNamespace;
  chains: [AuthorizationChainInput, ...AuthorizationChainInput[]];
};

export type SetChainAccountKeysOptions = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
  accountKeys: AccountKey[];
};

export type RevokeChainAuthorizationOptions = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
};

export type RevokeNamespaceAuthorizationOptions = {
  namespace: ChainNamespace;
};

export type ConnectionGrantChainRefs = [ChainRef, ...ChainRef[]];

/**
 * Persistent connection grant requested through `wallet_requestPermissions`.
 *
 * The protocol surface may expose the grant as an EIP-2255 capability, but its
 * stored meaning remains connection scope rather than signing or transaction authorization.
 */
export type ConnectionGrantRequest = {
  grantKind: ConnectionGrantKind;
  chainRefs: ConnectionGrantChainRefs;
};

export type RequestPermissionsApprovalPayload = {
  chainRef: ChainRef;
  requestedGrants: ConnectionGrantRequest[];
};

export type RequestPermissionsApprovalResult = {
  grantedGrants: ConnectionGrantRequest[];
};

export type PermissionController = {
  whenReady(): Promise<void>;

  getState(): PermissionsState;
  getAuthorization(origin: string, options: { namespace: ChainNamespace }): PermissionAuthorization | null;
  getChainAuthorization(
    origin: string,
    options: { namespace: ChainNamespace; chainRef: ChainRef },
  ): ChainPermissionAuthorization | null;
  listOriginPermissions(origin: string): PermissionAuthorization[];

  grantAuthorization(origin: string, options: GrantAuthorizationOptions): Promise<PermissionAuthorization>;
  setChainAccountKeys(origin: string, options: SetChainAccountKeysOptions): Promise<PermissionAuthorization>;
  revokeChainAuthorization(origin: string, options: RevokeChainAuthorizationOptions): Promise<void>;
  revokeNamespaceAuthorization(origin: string, options: RevokeNamespaceAuthorizationOptions): Promise<void>;
  revokeOriginPermissions(origin: string): Promise<void>;

  onStateChanged(handler: (state: PermissionsState) => void): () => void;
  onOriginChanged(handler: (payload: OriginPermissions) => void): () => void;

  destroy?(): void;
};
