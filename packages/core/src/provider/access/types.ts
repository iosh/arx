import type { ChainRef } from "../../chains/ids.js";
import type { JsonValue } from "../../errors.js";
import type { Unsubscribe } from "../../messenger/index.js";
import type {
  JsonRpcParams,
  JsonRpcRequest,
  RpcProviderExecutionContext,
  RpcProviderRequestContext,
} from "../../rpc/index.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../../session/unlock/types.js";
import type { ProviderRequestScope } from "./providerRequests.js";

export type { ProviderRequestScope } from "./providerRequests.js";

export type ProviderSnapshot = {
  namespace: string;
  chain: {
    chainId: string;
    chainRef: ChainRef;
  };
  isUnlocked: boolean;
};

export type ProviderConnectionScope = {
  namespace: string;
  origin: string;
};

export type ProviderConnectionQuery = ProviderConnectionScope;

export type ProviderConnectionState = {
  snapshot: ProviderSnapshot;
  accounts: string[];
};

export type ProviderConnectionStateChange = {
  scope: ProviderConnectionScope;
  previous: ProviderConnectionState;
  next: ProviderConnectionState;
  changed: {
    chain: boolean;
    accounts: boolean;
  };
};

export type ProviderConnectionStateChangedHandler = (change: ProviderConnectionStateChange) => void;

export type ProviderRequestContext = RpcProviderRequestContext;

export type ProviderExecutionContext = RpcProviderExecutionContext;

export type ProviderRpcRequest = JsonRpcRequest<JsonRpcParams>;

export type ProviderRequestInput = {
  scope: ProviderRequestScope;
  namespace: string;
  request: ProviderRpcRequest;
};

export type ResolvedProviderRequestContext = ProviderRequestScope & {
  namespace: string;
  chainRef: ChainRef;
};

export type ProviderRpcError =
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

export type ProviderRpcResponse =
  | {
      id: ProviderRpcRequest["id"];
      jsonrpc: "2.0";
      result: unknown;
    }
  | {
      id: ProviderRpcRequest["id"];
      jsonrpc: "2.0";
      error: ProviderRpcError;
    };

export type ProviderAccountsQuery = {
  origin: string;
  chainRef: ChainRef;
};

export type ProviderAccess = {
  buildSnapshot(input: ProviderConnectionQuery): ProviderSnapshot;
  buildConnectionState(input: ProviderConnectionQuery): Promise<ProviderConnectionState>;
  activateConnectionScope(input: ProviderConnectionScope): Promise<ProviderConnectionState>;
  deactivateConnectionScope(input: ProviderConnectionScope): void;
  subscribeConnectionStateChanged(listener: ProviderConnectionStateChangedHandler): Unsubscribe;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): () => void;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): () => void;
  request(input: ProviderRequestInput): Promise<ProviderRpcResponse>;
  encodeRpcError(error: unknown): ProviderRpcError;
  listPermittedAccounts(input: ProviderAccountsQuery): Promise<string[]>;
  cancelRequestScope(input: ProviderRequestScope): Promise<number>;
};
