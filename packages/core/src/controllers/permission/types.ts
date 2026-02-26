import type { ChainRef } from "../../chains/ids.js";
import { PermissionCapabilities } from "../../permissions/capabilities.js";
import type { RpcInvocationContext } from "../../rpc/handlers/types.js";
import type { ChainNamespace } from "../account/types.js";

export { PermissionCapabilities };
export type PermissionCapability = (typeof PermissionCapabilities)[keyof typeof PermissionCapabilities];

export type ChainPermissionState = {
  capabilities: PermissionCapability[];
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
  capabilities: PermissionCapability[];
  accounts?: string[];
};

export type GrantPermissionOptions = {
  namespace?: ChainNamespace | null;
  chainRef?: ChainRef | null;
};

export type PermissionCapabilityResolver = (
  method: string,
  context?: RpcInvocationContext,
) => PermissionCapability | undefined;

export type PermissionRequestDescriptor = {
  capability: PermissionCapability;
  chainRefs: ChainRef[];
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
  grant(origin: string, capability: PermissionCapability, options?: GrantPermissionOptions): Promise<void>;
  clear(origin: string): Promise<void>;
  getPermissions(origin: string): OriginPermissionState | undefined;
  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void;
  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void;

  // Optional lifecycle hook for store-backed implementations.
  destroy?(): void;
};
