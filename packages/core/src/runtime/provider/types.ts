import type { ChainRef } from "../../chains/ids.js";
import type { JsonValue } from "../../error.js";
import type {
  JsonRpcParams,
  JsonRpcRequest,
  RpcProviderExecutionContext,
  RpcProviderRequestContext,
} from "../../rpc/index.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../runtime/session/unlock/types.js";
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

export type ProviderRuntimeRpcError =
  | {
      kind: "ArxError";
      code: string;
    }
  | {
      kind: "JsonRpcError";
      code: number;
      message: string;
      data?: JsonValue;
    };

export type ProviderRuntimeRpcResponse =
  | {
      id: ProviderRuntimeRpcRequest["id"];
      jsonrpc: "2.0";
      result: unknown;
    }
  | {
      id: ProviderRuntimeRpcRequest["id"];
      jsonrpc: "2.0";
      error: ProviderRuntimeRpcError;
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
  executeRpcRequest(request: ProviderRuntimeRpcRequest): Promise<ProviderRuntimeRpcResponse>;
  encodeRuntimeRpcError(error: unknown): ProviderRuntimeRpcError;
  listPermittedAccounts(input: ProviderRuntimeAccountsQuery): Promise<string[]>;
  cancelRequestScope(input: ProviderRuntimeRequestScope): Promise<number>;
};
