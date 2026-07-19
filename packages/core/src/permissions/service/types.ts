import type { AccountId } from "../../accounts/accountId.js";
import type { Namespace } from "../../namespaces/types.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { ConnectionGrantKind } from "../connectionGrantKinds.js";

export type ChainPermissionState = {
  accountIds: AccountId[];
};

export type NamespacePermissionState = {
  chains: Record<ChainRef, ChainPermissionState>;
};

export type OriginPermissionState = Record<Namespace, NamespacePermissionState>;

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
  namespace: Namespace;
  chains: Record<ChainRef, ChainPermissionState>;
};

export type ChainPermissionAuthorization = {
  origin: string;
  namespace: Namespace;
  chainRef: ChainRef;
  accountIds: AccountId[];
};

export type AuthorizationChainInput = {
  chainRef: ChainRef;
  accountIds: AccountId[];
};

export type GrantAuthorizationOptions = {
  namespace: Namespace;
  chains: [AuthorizationChainInput, ...AuthorizationChainInput[]];
};

export type SetChainAccountIdsOptions = {
  namespace: Namespace;
  chainRef: ChainRef;
  accountIds: AccountId[];
};

export type RevokeChainAuthorizationOptions = {
  namespace: Namespace;
  chainRef: ChainRef;
};

export type RevokeNamespaceAuthorizationOptions = {
  namespace: Namespace;
};

export type RevokePermissionResult = {
  removed: boolean;
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

export type PermissionsReader = {
  getState(): PermissionsState;
  getAuthorization(origin: string, options: { namespace: Namespace }): PermissionAuthorization | null;
  getChainAuthorization(
    origin: string,
    options: { namespace: Namespace; chainRef: ChainRef },
  ): ChainPermissionAuthorization | null;
  listOriginPermissions(origin: string): PermissionAuthorization[];
};

export type PermissionsWriter = {
  grantAuthorization(origin: string, options: GrantAuthorizationOptions): Promise<PermissionAuthorization>;
  setChainAccountIds(origin: string, options: SetChainAccountIdsOptions): Promise<PermissionAuthorization>;
  revokeChainAuthorization(origin: string, options: RevokeChainAuthorizationOptions): Promise<RevokePermissionResult>;
  revokeNamespaceAuthorization(
    origin: string,
    options: RevokeNamespaceAuthorizationOptions,
  ): Promise<RevokePermissionResult>;
  revokeOriginPermissions(origin: string): Promise<RevokePermissionResult>;
};

export type PermissionsEvents = {
  onStateChanged(handler: (state: PermissionsState) => void): () => void;
  onOriginChanged(handler: (payload: OriginPermissions) => void): () => void;
};
