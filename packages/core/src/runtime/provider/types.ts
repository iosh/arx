import type { ChainRef } from "../../chains/ids.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import type { JsonRpcError, JsonRpcParams, JsonRpcRequest, JsonRpcResponse } from "../../rpc/index.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkPreferencesChangedHandler } from "../../services/store/networkPreferences/types.js";

export type ProviderRuntimeMeta = {
  activeChainByNamespace: Record<string, ChainRef>;
  supportedChains: ChainRef[];
};

export type ProviderRuntimeSnapshot = {
  namespace: string;
  chain: {
    chainId: string;
    chainRef: ChainRef;
  };
  isUnlocked: boolean;
  meta: ProviderRuntimeMeta;
};

export type ProviderRuntimeConnectionQuery = {
  namespace: string;
  origin: string;
};

export type ProviderRuntimeConnectionState = {
  snapshot: ProviderRuntimeSnapshot;
  accounts: string[];
};

export type ProviderRuntimeRequestContext = RequestContext & {
  transport: "provider";
};

export type ProviderRuntimeRpcContext = {
  chainRef?: ChainRef | null;
  providerNamespace?: string | null;
  requestContext?: ProviderRuntimeRequestContext | null;
};

export type ProviderRuntimeRpcRequest = JsonRpcRequest<JsonRpcParams> & {
  origin: string;
  context?: ProviderRuntimeRpcContext;
};

export type ProviderRuntimeErrorContext = {
  origin: string;
  method: string;
  rpcContext?: ProviderRuntimeRpcContext | undefined;
};

export type ProviderRuntimeAccountsQuery = {
  origin: string;
  chainRef: ChainRef;
};

export type ProviderRuntimeSessionScope = {
  origin: string;
  portId: string;
  sessionId: string;
};

export type ProviderRuntimeAccess = {
  buildSnapshot(namespace: string): ProviderRuntimeSnapshot;
  buildConnectionState(input: ProviderRuntimeConnectionQuery): Promise<ProviderRuntimeConnectionState>;
  getActiveChainByNamespace(): Record<string, ChainRef>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
  subscribeNetworkStateChanged(listener: () => void): () => void;
  subscribeNetworkPreferencesChanged(listener: NetworkPreferencesChangedHandler): () => void;
  subscribeAccountsStateChanged(listener: () => void): () => void;
  subscribePermissionsStateChanged(listener: () => void): () => void;
  executeRpcRequest(request: ProviderRuntimeRpcRequest): Promise<JsonRpcResponse>;
  encodeRpcError(error: unknown, context: ProviderRuntimeErrorContext): JsonRpcError;
  listPermittedAccounts(input: ProviderRuntimeAccountsQuery): Promise<string[]>;
  cancelSessionApprovals(input: ProviderRuntimeSessionScope): Promise<number>;
};
