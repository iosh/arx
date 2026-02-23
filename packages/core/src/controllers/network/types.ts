import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata, RpcEndpoint } from "../../chains/metadata.js";

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

export type RpcRoutingState = {
  activeIndex: number;
  strategy: RpcStrategyConfig;
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
  revision: number;
  activeChain: ChainRef;
  knownChains: ChainMetadata[];
  rpc: Record<ChainRef, RpcRoutingState>;
};

export type NetworkStateInput = Omit<NetworkState, "revision">;

export type RpcEndpointChange = {
  chainRef: ChainRef;
  previous: RpcEndpointInfo;
  next: RpcEndpointInfo;
};

export type RpcLogEvent = {
  level: "info" | "warn";
  event: "rpcFailure" | "rpcRecovery" | "strategyChanged";
  chainRef: ChainRef;
  endpoint?: RpcEndpointInfo;
  nextEndpoint?: RpcEndpointInfo;
  consecutiveFailures?: number;
  failureCount?: number;
  strategy?: RpcStrategyConfig;
  error?: RpcFailure;
  recoveryMs?: number;
};

export type RpcEventLogger = (event: RpcLogEvent) => void;

export interface NetworkController {
  getState(): NetworkState;
  getActiveChain(): ChainMetadata;
  getChain(chainRef: ChainRef): ChainMetadata | null;
  getActiveEndpoint(chainRef?: ChainRef): RpcEndpointInfo;
  onStateChanged(handler: (state: NetworkState) => void): () => void;
  onActiveChainChanged(handler: (payload: { previous: ChainRef; next: ChainRef }) => void): () => void;
  onChainMetadataChanged(
    handler: (payload: { chainRef: ChainRef; previous: ChainMetadata | null; next: ChainMetadata | null }) => void,
  ): () => void;
  onRpcEndpointChanged(handler: (change: RpcEndpointChange) => void): () => void;
  onRpcHealthChanged(handler: (update: { chainRef: ChainRef; health: RpcEndpointHealth[] }) => void): () => void;
  switchChain(target: ChainRef): Promise<ChainMetadata>;
  reportRpcOutcome(chainRef: ChainRef, outcome: RpcOutcomeReport): void;
  setStrategy(chainRef: ChainRef, strategy: RpcStrategyConfig): void;
  replaceState(state: NetworkStateInput): void;
}
