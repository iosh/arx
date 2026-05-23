import type { ChainRef } from "../../chains/ids.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import type {
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResponse,
  RpcProviderExecutionContext,
  RpcProviderRequestContext,
} from "../../rpc/index.js";
import type { StateChangeSubscription } from "../../services/store/_shared/signal.js";
import type { ProviderRuntimeRequestScope } from "./providerRequests.js";

export type { ProviderRuntimeRequestScope } from "./providerRequests.js";

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

export type ProviderRuntimeRequestContext = RpcProviderRequestContext;

export type ProviderRuntimeExecutionContext = RpcProviderExecutionContext;

export type ProviderRuntimeRequestExecution = {
  requestScope: ProviderRuntimeRequestScope;
};

export type ProviderRuntimeRpcContext = {
  providerNamespace: string;
  chainRef?: ChainRef;
};

export type ProviderRuntimeRpcRequest = JsonRpcRequest<JsonRpcParams> & {
  origin: string;
  context: ProviderRuntimeRpcContext;
  execution: ProviderRuntimeRequestExecution;
};

export type ProviderRuntimeErrorContext = {
  origin: string;
  method: string;
  context: ProviderRuntimeRpcContext;
};

export type ProviderRuntimeAccountsQuery = {
  origin: string;
  chainRef: ChainRef;
};

export type ProviderRuntimeAccess = {
  buildSnapshot(namespace: string): ProviderRuntimeSnapshot;
  buildConnectionState(input: ProviderRuntimeConnectionQuery): Promise<ProviderRuntimeConnectionState>;
  getActiveChainByNamespace(): Record<string, ChainRef>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
  subscribeNetworkStateChanged(listener: () => void): () => void;
  subscribeNetworkSelectionChanged: StateChangeSubscription;
  subscribeAccountsStateChanged(listener: () => void): () => void;
  subscribePermissionsStateChanged(listener: () => void): () => void;
  executeRpcRequest(request: ProviderRuntimeRpcRequest): Promise<JsonRpcResponse>;
  encodeRpcError(error: unknown, context: ProviderRuntimeErrorContext): JsonRpcError;
  listPermittedAccounts(input: ProviderRuntimeAccountsQuery): Promise<string[]>;
  cancelRequestScope(input: ProviderRuntimeRequestScope): Promise<number>;
};
