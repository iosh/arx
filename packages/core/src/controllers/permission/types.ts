import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { RpcInvocationContext } from "../../rpc/handlers/types.js";

export const PermissionScopes = {
  Basic: "wallet_basic",
  Accounts: "wallet_accounts",
  Sign: "wallet_sign",
  Transaction: "wallet_transaction",
} as const;

export type PermissionScope = (typeof PermissionScopes)[keyof typeof PermissionScopes];

export type OriginPermissions = {
  origin: string;
  scopes: PermissionScope[];
};

export type PermissionsState = {
  origins: Record<string, PermissionScope[]>;
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

export type PermissionController = {
  getState(): PermissionsState;
  ensurePermission(origin: string, method: string, context?: RpcInvocationContext): Promise<void>;
  grant(origin: string, scope: PermissionScope): Promise<void>;
  clear(origin: string): Promise<void>;
  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void;
  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void;
  replaceState(state: PermissionsState): void;
};
