import type { Caip2ChainId } from "../../chains/ids.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { RpcInvocationContext } from "../../rpc/handlers/types.js";
import type { ChainNamespace } from "../account/types.js";

export const PermissionScopes = {
  Basic: "wallet_basic",
  Accounts: "wallet_accounts",
  Sign: "wallet_sign",
  Transaction: "wallet_transaction",
} as const;

export type PermissionScope = (typeof PermissionScopes)[keyof typeof PermissionScopes];

export type NamespacePermissionState = {
  scopes: PermissionScope[];
  chains: Caip2ChainId[];
};

export type OriginPermissionState = Record<ChainNamespace, NamespacePermissionState>;

export type OriginPermissions = {
  origin: string;
  namespaces: OriginPermissionState;
};

export type PermissionsState = {
  origins: Record<string, OriginPermissionState>;
};

export type GrantPermissionOptions = {
  namespace?: ChainNamespace | null;
  chainRef?: Caip2ChainId | null;
};

export type PermissionMessengerTopics = {
  "permission:stateChanged": PermissionsState;
  "permission:originChanged": OriginPermissions;
};

export type PermissionMessenger = ControllerMessenger<PermissionMessengerTopics>;

export type PermissionScopeResolver = (method: string, context?: RpcInvocationContext) => PermissionScope | undefined;

export type PermissionControllerOptions = {
  messenger: PermissionMessenger;
  scopeResolver: PermissionScopeResolver;
  initialState?: PermissionsState;
};

export type PermissionRequestDescriptor = {
  scope: PermissionScope;
  capability: string;
  chains: Caip2ChainId[];
};

export type RequestPermissionsApprovalPayload = {
  requested: PermissionRequestDescriptor[];
};

export type PermissionApprovalResult = {
  granted: PermissionRequestDescriptor[];
};

export type PermissionController = {
  getState(): PermissionsState;
  ensurePermission(origin: string, method: string, context?: RpcInvocationContext): Promise<void>;
  grant(origin: string, scope: PermissionScope, options?: GrantPermissionOptions): Promise<void>;
  clear(origin: string): Promise<void>;
  getPermissions(origin: string): OriginPermissionState | undefined;
  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void;
  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void;
  replaceState(state: PermissionsState): void;
};
