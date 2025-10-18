import type { Caip2ChainId } from "../../chains/ids.js";
import type { ChainMetadata, RpcEndpoint } from "../../chains/metadata.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export type RpcStrategyId = "round-robin" | string;

export type RpcStrategyConfig = {
  id: RpcStrategyId;
  options?: Record<string, unknown> | undefined;
};

export type RpcFailure = {
  message: string;
  code?: number | string | undefined;
  data?: unknown | undefined;
};

export type RpcErrorSnapshot = RpcFailure & {
  capturedAt: number;
};

export type RpcEndpointInfo = RpcEndpoint & {
  index: number;
};

export type RpcEndpointHealth = {
  index: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastError?: RpcErrorSnapshot | undefined;
  lastFailureAt?: number | undefined;
  cooldownUntil?: number | undefined;
};

export type RpcEndpointState = {
  activeIndex: number;
  endpoints: RpcEndpointInfo[];
  health: RpcEndpointHealth[];
  strategy: RpcStrategyConfig;
  lastUpdatedAt: number;
};

export type RpcOutcomeReport =
  | {
      success: true;
      endpointIndex?: number;
    }
  | {
      success: false;
      error: RpcFailure;
      endpointIndex?: number;
      cooldownMs?: number;
    };

export type NetworkState = {
  activeChain: Caip2ChainId;
  knownChains: ChainMetadata[];
  rpc: Record<Caip2ChainId, RpcEndpointState>;
};

export type RpcEndpointChange = {
  chainRef: Caip2ChainId;
  previous: RpcEndpointInfo;
  next: RpcEndpointInfo;
};

export type RpcLogEvent = {
  level: "info" | "warn";
  event: "rpcFailure" | "rpcRecovery" | "strategyChanged" | "endpointsUpdated";
  chainRef: Caip2ChainId;
  endpoint?: RpcEndpointInfo;
  nextEndpoint?: RpcEndpointInfo;
  consecutiveFailures?: number;
  failureCount?: number;
  strategy?: RpcStrategyConfig;
  error?: RpcFailure;
  recoveryMs?: number;
};

export type RpcEventLogger = (event: RpcLogEvent) => void;

export type NetworkMessengerTopic = {
  "network:stateChanged": NetworkState;
  "network:chainChanged": ChainMetadata;
  "network:rpcEndpointChanged": RpcEndpointChange;
  "network:rpcHealthChanged": { chainRef: Caip2ChainId; state: RpcEndpointState };
};

export type NetworkMessenger = ControllerMessenger<NetworkMessengerTopic>;

export interface NetworkController {
  getState(): NetworkState;
  getActiveChain(): ChainMetadata;
  getChain(chainRef: Caip2ChainId): ChainMetadata | null;
  getEndpointState(chainRef: Caip2ChainId): RpcEndpointState | null;
  getActiveEndpoint(chainRef?: Caip2ChainId): RpcEndpointInfo;
  onStateChanged(handler: (state: NetworkState) => void): () => void;
  onChainChanged(handler: (chain: ChainMetadata) => void): () => void;
  onRpcEndpointChanged(handler: (change: RpcEndpointChange) => void): () => void;
  onRpcHealthChanged(handler: (update: { chainRef: Caip2ChainId; state: RpcEndpointState }) => void): () => void;
  switchChain(target: Caip2ChainId): Promise<ChainMetadata>;
  addChain(
    chain: ChainMetadata,
    options?: { activate?: boolean; strategy?: RpcStrategyConfig },
  ): Promise<ChainMetadata>;
  removeChain(chainRef: Caip2ChainId): Promise<void>;
  reportRpcOutcome(chainRef: Caip2ChainId, outcome: RpcOutcomeReport): void;
  setStrategy(chainRef: Caip2ChainId, strategy: RpcStrategyConfig): void;
  syncChain(chain: ChainMetadata): Promise<void>;
  replaceState(state: NetworkState): void;
}
