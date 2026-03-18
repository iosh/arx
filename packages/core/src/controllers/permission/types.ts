import type { ChainRef } from "../../chains/ids.js";
import { PermissionCapabilities } from "../../permissions/capabilities.js";
import type { AccountKey } from "../../storage/records.js";
import type { ChainNamespace } from "../account/types.js";

export { PermissionCapabilities };
export type PermissionCapability = (typeof PermissionCapabilities)[keyof typeof PermissionCapabilities];

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

export type UpsertAuthorizationOptions = {
  namespace: ChainNamespace;
  chains: [AuthorizationChainInput, ...AuthorizationChainInput[]];
};

export type SetChainAccountKeysOptions = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
  accountKeys: AccountKey[];
};

export type MutatePermittedChainsOptions = {
  namespace: ChainNamespace;
  chainRefs: [ChainRef, ...ChainRef[]];
};

export type PermissionRequestChainRefs = [ChainRef, ...ChainRef[]];

export type PermissionRequestDescriptor = {
  capability: PermissionCapability;
  chainRefs: PermissionRequestChainRefs;
};

export type RequestPermissionsApprovalPayload = {
  chainRef: ChainRef;
  requested: PermissionRequestDescriptor[];
};

export type PermissionApprovalResult = {
  granted: PermissionRequestDescriptor[];
};

export type PermissionController = {
  whenReady(): Promise<void>;

  getState(): PermissionsState;
  getAuthorization(origin: string, options: { namespace: ChainNamespace }): PermissionAuthorization | null;
  getChainAuthorization(
    origin: string,
    options: { namespace: ChainNamespace; chainRef: ChainRef },
  ): ChainPermissionAuthorization | null;
  listAuthorizations(origin: string): PermissionAuthorization[];

  upsertAuthorization(origin: string, options: UpsertAuthorizationOptions): Promise<PermissionAuthorization>;
  setChainAccountKeys(origin: string, options: SetChainAccountKeysOptions): Promise<PermissionAuthorization>;
  addPermittedChains(origin: string, options: MutatePermittedChainsOptions): Promise<PermissionAuthorization>;
  revokePermittedChains(origin: string, options: MutatePermittedChainsOptions): Promise<void>;
  clearOrigin(origin: string): Promise<void>;

  onStateChanged(handler: (state: PermissionsState) => void): () => void;
  onOriginChanged(handler: (payload: OriginPermissions) => void): () => void;

  destroy?(): void;
};
