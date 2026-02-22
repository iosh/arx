import type { ChainRef } from "../../chains/ids.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { PermissionScopes } from "../../permissions/constants.js";
import type { RpcInvocationContext } from "../../rpc/handlers/types.js";
import type { ChainNamespace } from "../account/types.js";

export { PermissionScopes };
export type PermissionScope = (typeof PermissionScopes)[keyof typeof PermissionScopes];

export type ChainPermissionState = {
  scopes: PermissionScope[];
  // EIP-155 only for now; keep per-chain to avoid leaking accounts to non-connected chains.
  accounts?: string[];
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

export type PermissionGrant = {
  origin: string;
  namespace: ChainNamespace;
  chainRef: ChainRef;
  scopes: PermissionScope[];
  accounts?: string[];
};

export type GrantPermissionOptions = {
  namespace?: ChainNamespace | null;
  chainRef?: ChainRef | null;
};

export type PermissionMessengerTopics = {
  "permission:stateChanged": PermissionsState;
  "permission:originChanged": OriginPermissions;
};

export type PermissionMessenger = ControllerMessenger<PermissionMessengerTopics>;

export type PermissionScopeResolver = (method: string, context?: RpcInvocationContext) => PermissionScope | undefined;

export type PermissionRequestDescriptor = {
  scope: PermissionScope;
  capability: string;
  chains: ChainRef[];
};

export type RequestPermissionsApprovalPayload = {
  requested: PermissionRequestDescriptor[];
};

export type PermissionApprovalResult = {
  granted: PermissionRequestDescriptor[];
};

export type PermissionController = {
  whenReady(): Promise<void>;
  listGrants(origin: string): PermissionGrant[];

  getState(): PermissionsState;
  listConnectedOrigins(options: { namespace: ChainNamespace }): string[];

  getPermittedAccounts(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): string[];
  setPermittedAccounts(
    origin: string,
    options: { namespace?: ChainNamespace | null; chainRef: ChainRef; accounts: string[] },
  ): Promise<void>;
  isConnected(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): boolean;

  assertPermission(origin: string, method: string, context?: RpcInvocationContext): Promise<void>;
  grant(origin: string, scope: PermissionScope, options?: GrantPermissionOptions): Promise<void>;
  clear(origin: string): Promise<void>;
  getPermissions(origin: string): OriginPermissionState | undefined;
  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void;
  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void;
};
