import type { ChainRef } from "../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata, type RpcEndpoint } from "../../chains/metadata.js";
import type {
  NetworkController,
  NetworkMessenger,
  NetworkState,
  RpcEndpointChange,
  RpcEndpointHealth,
  RpcEndpointInfo,
  RpcEndpointState,
  RpcEventLogger,
  RpcLogEvent,
  RpcOutcomeReport,
  RpcStrategyConfig,
} from "./types.js";

const NETWORK_STATE_TOPIC = "network:stateChanged";
const NETWORK_CHAIN_TOPIC = "network:chainChanged";
const NETWORK_RPC_ENDPOINT_TOPIC = "network:rpcEndpointChanged";
const NETWORK_RPC_HEALTH_TOPIC = "network:rpcHealthChanged";

const DEFAULT_STRATEGY: RpcStrategyConfig = { id: "round-robin" };

const defaultLogger: RpcEventLogger = () => {};

type NetworkControllerOptions = {
  messenger: NetworkMessenger;
  initialState: NetworkState;
  defaultStrategy?: RpcStrategyConfig;
  now?: () => number;
  logger?: RpcEventLogger;
  defaultCooldownMs?: number;
};

type ChainRuntime = {
  metadata: ChainMetadata;
  strategy: RpcStrategyConfig;
  endpoints: RpcEndpoint[];
  health: RpcEndpointHealth[];
  activeIndex: number;
  lastUpdatedAt: number;
};

const cloneHeaders = (headers?: Record<string, string>) => {
  if (!headers) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(headers));
};

const cloneRpcEndpoint = (endpoint: RpcEndpoint): RpcEndpoint => {
  const clone: RpcEndpoint = { url: endpoint.url };
  if (endpoint.type) clone.type = endpoint.type;
  if (endpoint.weight !== undefined) clone.weight = endpoint.weight;
  if (endpoint.headers) clone.headers = cloneHeaders(endpoint.headers);
  return clone;
};

const sortChains = (chains: ChainMetadata[]) => {
  return [...chains].sort((a, b) => a.chainRef.localeCompare(b.chainRef));
};

const cloneHealth = (health: RpcEndpointHealth[]): RpcEndpointHealth[] =>
  health.map((entry) => ({
    index: entry.index,
    successCount: entry.successCount,
    failureCount: entry.failureCount,
    consecutiveFailures: entry.consecutiveFailures,
    lastError: entry.lastError ? { ...entry.lastError } : undefined,
    lastFailureAt: entry.lastFailureAt,
    cooldownUntil: entry.cooldownUntil,
  }));

const buildEndpointInfoList = (endpoints: RpcEndpoint[]): RpcEndpointInfo[] =>
  endpoints.map((endpoint, index) => ({
    index,
    url: endpoint.url,
    type: endpoint.type,
    weight: endpoint.weight,
    headers: endpoint.headers ? cloneHeaders(endpoint.headers) : undefined,
  }));

const deriveStrategyConfig = (strategy?: RpcStrategyConfig): RpcStrategyConfig => {
  if (!strategy) return { ...DEFAULT_STRATEGY };
  return { id: strategy.id, options: strategy.options ? { ...strategy.options } : undefined };
};

export class InMemoryNetworkController implements NetworkController {
  #messenger: NetworkMessenger;
  #chains = new Map<ChainRef, ChainRuntime>();
  #activeChain: ChainRef;
  #defaultStrategy: RpcStrategyConfig;
  #now: () => number;
  #logger: RpcEventLogger;
  #defaultCooldownMs: number;

  constructor({
    messenger,
    initialState,
    defaultStrategy,
    now = Date.now,
    logger = defaultLogger,
    defaultCooldownMs = 5_000,
  }: NetworkControllerOptions) {
    this.#messenger = messenger;
    this.#defaultStrategy = deriveStrategyConfig(defaultStrategy);
    this.#now = now;
    this.#logger = logger;
    this.#defaultCooldownMs = defaultCooldownMs;
    this.#activeChain = initialState.activeChain;

    this.#applyState(initialState);
    this.#publishState(true);
  }

  getState(): NetworkState {
    return this.#buildStateSnapshot();
  }

  getActiveChain(): ChainMetadata {
    return cloneChainMetadata(this.#requireRuntime(this.#activeChain).metadata);
  }

  getChain(chainRef: ChainRef): ChainMetadata | null {
    const runtime = this.#chains.get(chainRef);
    return runtime ? cloneChainMetadata(runtime.metadata) : null;
  }

  getEndpointState(chainRef: ChainRef): RpcEndpointState | null {
    const runtime = this.#chains.get(chainRef);
    if (!runtime) return null;
    return this.#buildEndpointState(chainRef, runtime);
  }

  getActiveEndpoint(chainRef?: ChainRef): RpcEndpointInfo {
    const runtime = this.#requireRuntime(chainRef ?? this.#activeChain);
    const index = runtime.activeIndex;
    const endpoint = runtime.endpoints[index];
    if (!endpoint) {
      throw new Error(`Active endpoint index ${index} is out of bounds for ${runtime.metadata.chainRef}`);
    }
    return {
      index,
      url: endpoint.url,
      type: endpoint.type,
      weight: endpoint.weight,
      headers: endpoint.headers ? cloneHeaders(endpoint.headers) : undefined,
    };
  }

  onStateChanged(handler: (state: NetworkState) => void): () => void {
    return this.#messenger.subscribe(NETWORK_STATE_TOPIC, handler);
  }

  onChainChanged(handler: (chain: ChainMetadata) => void): () => void {
    return this.#messenger.subscribe(NETWORK_CHAIN_TOPIC, handler);
  }

  onRpcEndpointChanged(handler: (change: RpcEndpointChange) => void): () => void {
    return this.#messenger.subscribe(NETWORK_RPC_ENDPOINT_TOPIC, handler);
  }

  onRpcHealthChanged(handler: (update: { chainRef: ChainRef; state: RpcEndpointState }) => void): () => void {
    return this.#messenger.subscribe(NETWORK_RPC_HEALTH_TOPIC, handler);
  }

  async switchChain(target: ChainRef): Promise<ChainMetadata> {
    if (this.#activeChain === target) {
      return this.getActiveChain();
    }
    const runtime = this.#chains.get(target);
    if (!runtime) {
      throw new Error(`Unknown chain: ${target}`);
    }
    this.#activeChain = target;
    this.#publishState();
    return cloneChainMetadata(runtime.metadata);
  }

  async addChain(
    metadata: ChainMetadata,
    options?: { activate?: boolean; strategy?: RpcStrategyConfig },
  ): Promise<ChainMetadata> {
    const incoming = cloneChainMetadata(metadata);
    const existing = this.#chains.get(incoming.chainRef);
    const strategy = deriveStrategyConfig(options?.strategy ?? existing?.strategy ?? this.#defaultStrategy);
    const runtime = this.#createRuntime(incoming, strategy, existing);
    this.#chains.set(incoming.chainRef, runtime);

    if (options?.activate || this.#chains.size === 1) {
      this.#activeChain = incoming.chainRef;
    }

    this.#publishState();
    return cloneChainMetadata(runtime.metadata);
  }

  async removeChain(chainRef: ChainRef): Promise<void> {
    if (!this.#chains.has(chainRef)) {
      return;
    }
    this.#chains.delete(chainRef);
    if (this.#chains.size === 0) {
      throw new Error("NetworkController requires at least one registered chain");
    }
    if (this.#activeChain === chainRef) {
      const [first] = this.#chains.keys();
      this.#activeChain = first ?? Array.from(this.#chains.keys())[0]!;
    }
    this.#publishState();
  }

  reportRpcOutcome(chainRef: ChainRef, outcome: RpcOutcomeReport): void {
    const runtime = this.#requireRuntime(chainRef);
    if (runtime.endpoints.length === 0) {
      throw new Error(`Cannot report RPC outcome for chain ${chainRef} without endpoints`);
    }

    const now = this.#now();
    const targetIndex = this.#selectEndpointIndex(runtime, outcome.endpointIndex);
    runtime.activeIndex = targetIndex;
    const health = runtime.health[targetIndex]!;

    let endpointChanged = false;
    const previousEndpoint = this.#buildEndpointInfo(chainRef, runtime, targetIndex);

    if (outcome.success) {
      const previousConsecutiveFailures = health.consecutiveFailures;
      const cumulativeFailures = health.failureCount;
      const lastError = health.lastError ? { ...health.lastError } : undefined;
      const lastFailureAt = health.lastFailureAt;

      health.successCount += 1;
      health.consecutiveFailures = 0;
      health.lastError = undefined;
      health.lastFailureAt = undefined;
      health.cooldownUntil = undefined;
      runtime.lastUpdatedAt = now;
      this.#publishState();
      this.#publishRpcHealth(chainRef, runtime);
      if (cumulativeFailures > 0) {
        const recoveryMs = typeof lastFailureAt === "number" ? Math.max(0, now - lastFailureAt) : undefined;
        const recoveryEvent: RpcLogEvent = {
          level: "info",
          event: "rpcRecovery",
          chainRef,
          endpoint: previousEndpoint,
          ...(previousConsecutiveFailures > 0 ? { consecutiveFailures: previousConsecutiveFailures } : {}),
          failureCount: cumulativeFailures,
          ...(typeof recoveryMs === "number" ? { recoveryMs } : {}),
          ...(lastError
            ? {
                error: {
                  message: lastError.message,
                  code: lastError.code,
                  data: lastError.data,
                },
              }
            : {}),
        };
        this.#logger(recoveryEvent);
      }
      return;
    }

    health.failureCount += 1;
    health.consecutiveFailures += 1;
    health.lastError = {
      message: outcome.error.message,
      code: outcome.error.code,
      data: outcome.error.data,
      capturedAt: now,
    };
    health.lastFailureAt = now;
    const cooldown = outcome.cooldownMs ?? this.#defaultCooldownMs;
    if (cooldown > 0) {
      health.cooldownUntil = now + cooldown;
    }

    const nextIndex = this.#selectNextEndpoint(runtime, now, targetIndex);
    if (nextIndex !== runtime.activeIndex) {
      runtime.activeIndex = nextIndex;
      endpointChanged = true;
    }
    runtime.lastUpdatedAt = now;

    const nextEndpoint = this.#buildEndpointInfo(chainRef, runtime, runtime.activeIndex);

    this.#logger({
      level: endpointChanged ? "warn" : "info",
      event: "rpcFailure",
      chainRef,
      endpoint: previousEndpoint,
      nextEndpoint,
      consecutiveFailures: health.consecutiveFailures,
      error: {
        message: outcome.error.message,
        code: outcome.error.code,
        data: outcome.error.data,
      },
    });

    this.#publishState();
    this.#publishRpcHealth(chainRef, runtime);
    if (endpointChanged) {
      this.#publishEndpointChange(chainRef, previousEndpoint, nextEndpoint);
    }
  }

  setStrategy(chainRef: ChainRef, strategy: RpcStrategyConfig): void {
    const runtime = this.#requireRuntime(chainRef);
    runtime.strategy = deriveStrategyConfig(strategy);
    runtime.lastUpdatedAt = this.#now();
    this.#logger({
      level: "info",
      event: "strategyChanged",
      chainRef,
      strategy: runtime.strategy,
    });
    this.#publishState();
  }

  async syncChain(metadata: ChainMetadata): Promise<void> {
    const runtime = this.#requireRuntime(metadata.chainRef);
    const updated = cloneChainMetadata(metadata);
    const currentEndpoints = runtime.endpoints.map((endpoint) => endpoint.url);
    const nextEndpoints = updated.rpcEndpoints.map((endpoint) => endpoint.url);
    const endpointsChanged =
      currentEndpoints.length !== nextEndpoints.length ||
      currentEndpoints.some((url, index) => url !== nextEndpoints[index]);

    runtime.metadata = updated;
    if (endpointsChanged) {
      runtime.endpoints = updated.rpcEndpoints.map(cloneRpcEndpoint);
      runtime.health = this.#initialiseHealth(runtime.endpoints.length);
      runtime.activeIndex = Math.min(runtime.activeIndex, runtime.endpoints.length - 1);
      runtime.lastUpdatedAt = this.#now();
      this.#logger({
        level: "info",
        event: "endpointsUpdated",
        chainRef: metadata.chainRef,
        strategy: runtime.strategy,
      });
    }
    this.#publishState();
  }

  replaceState(state: NetworkState): void {
    this.#activeChain = state.activeChain;
    this.#applyState(state);
    this.#publishState();
  }

  #applyState(state: NetworkState) {
    if (!state.knownChains.some((chain) => chain.chainRef === state.activeChain)) {
      throw new Error(`Active chain ${state.activeChain} must be present in knownChains`);
    }

    const chainMap = new Map<ChainRef, ChainRuntime>();
    for (const metadata of sortChains(state.knownChains.map(cloneChainMetadata))) {
      const snapshot = state.rpc[metadata.chainRef];
      const strategy = deriveStrategyConfig(snapshot?.strategy ?? this.#defaultStrategy);
      const runtime = this.#createRuntimeFromSnapshot(metadata, strategy, snapshot);
      chainMap.set(metadata.chainRef, runtime);
    }

    this.#chains = chainMap;
    this.#activeChain = state.activeChain;
  }

  #createRuntime(metadata: ChainMetadata, strategy: RpcStrategyConfig, previous?: ChainRuntime): ChainRuntime {
    const endpoints = metadata.rpcEndpoints.map(cloneRpcEndpoint);
    if (endpoints.length === 0) {
      throw new Error(`Chain ${metadata.chainRef} must expose at least one RPC endpoint`);
    }

    let activeIndex = previous?.activeIndex ?? 0;
    if (activeIndex >= endpoints.length) {
      activeIndex = 0;
    }

    const health =
      previous && previous.health.length === endpoints.length
        ? cloneHealth(previous.health)
        : this.#initialiseHealth(endpoints.length);

    return {
      metadata,
      strategy: deriveStrategyConfig(strategy),
      endpoints,
      health,
      activeIndex,
      lastUpdatedAt: this.#now(),
    };
  }

  #createRuntimeFromSnapshot(
    metadata: ChainMetadata,
    strategy: RpcStrategyConfig,
    snapshot?: RpcEndpointState,
  ): ChainRuntime {
    const fromMetadata = metadata.rpcEndpoints.map(cloneRpcEndpoint);
    if (!snapshot) {
      return {
        metadata,
        strategy,
        endpoints: fromMetadata,
        health: this.#initialiseHealth(fromMetadata.length),
        activeIndex: 0,
        lastUpdatedAt: this.#now(),
      };
    }

    if (snapshot.endpoints.length !== fromMetadata.length) {
      return {
        metadata,
        strategy,
        endpoints: fromMetadata,
        health: this.#initialiseHealth(fromMetadata.length),
        activeIndex: Math.min(snapshot.activeIndex, Math.max(0, fromMetadata.length - 1)),
        lastUpdatedAt: this.#now(),
      };
    }

    const health =
      snapshot.health.length === fromMetadata.length
        ? cloneHealth(snapshot.health)
        : this.#initialiseHealth(fromMetadata.length);

    return {
      metadata,
      strategy,
      endpoints: fromMetadata,
      health,
      activeIndex: Math.min(snapshot.activeIndex, Math.max(0, fromMetadata.length - 1)),
      lastUpdatedAt: snapshot.lastUpdatedAt ?? this.#now(),
    };
  }

  #initialiseHealth(count: number): RpcEndpointHealth[] {
    if (count === 0) {
      throw new Error("RPC endpoints list cannot be empty");
    }
    const health: RpcEndpointHealth[] = [];
    for (let index = 0; index < count; index += 1) {
      health.push({
        index,
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
      });
    }
    return health;
  }

  #selectEndpointIndex(runtime: ChainRuntime, provided?: number): number {
    if (provided === undefined) {
      return runtime.activeIndex;
    }
    if (provided < 0 || provided >= runtime.endpoints.length) {
      return runtime.activeIndex;
    }
    return provided;
  }

  #selectNextEndpoint(runtime: ChainRuntime, now: number, failedIndex: number): number {
    const total = runtime.endpoints.length;
    if (total === 1) {
      return 0;
    }
    const strategyId = runtime.strategy.id ?? "round-robin";
    if (strategyId !== "round-robin") {
      // Placeholder for future strategy expansion.
    }

    let candidate = (failedIndex + 1) % total;
    for (let attempts = 0; attempts < total; attempts += 1) {
      const health = runtime.health[candidate]!;
      if (!health.cooldownUntil || health.cooldownUntil <= now) {
        return candidate;
      }
      candidate = (candidate + 1) % total;
    }
    const failedHealth = runtime.health[failedIndex]!;
    if (!failedHealth.cooldownUntil || failedHealth.cooldownUntil <= now) {
      return failedIndex;
    }
    const earliest = runtime.health.reduce<{ index: number; cooldownUntil: number } | null>((best, entry) => {
      if (!entry.cooldownUntil) return best;
      if (!best || entry.cooldownUntil < best.cooldownUntil) {
        return { index: entry.index, cooldownUntil: entry.cooldownUntil };
      }
      return best;
    }, null);
    return earliest ? earliest.index : failedIndex;
  }

  #buildStateSnapshot(): NetworkState {
    const knownChains = sortChains(
      Array.from(this.#chains.values(), (runtime) => cloneChainMetadata(runtime.metadata)),
    );
    const rpcEntries = Array.from(this.#chains.entries()).map(
      ([chainRef, runtime]) => [chainRef, this.#buildEndpointState(chainRef, runtime)] as const,
    );
    rpcEntries.sort((a, b) => a[0].localeCompare(b[0]));
    return {
      activeChain: this.#activeChain,
      knownChains,
      rpc: Object.fromEntries(rpcEntries),
    };
  }

  #buildEndpointState(chainRef: ChainRef, runtime: ChainRuntime): RpcEndpointState {
    return {
      activeIndex: runtime.activeIndex,
      endpoints: buildEndpointInfoList(runtime.endpoints),
      health: cloneHealth(runtime.health),
      strategy: deriveStrategyConfig(runtime.strategy),
      lastUpdatedAt: runtime.lastUpdatedAt,
    };
  }

  #buildEndpointInfo(chainRef: ChainRef, runtime: ChainRuntime, index: number): RpcEndpointInfo {
    const endpoint = runtime.endpoints[index];
    if (!endpoint) {
      throw new Error(`Endpoint index ${index} is out of bounds for ${chainRef}`);
    }
    return {
      index,
      url: endpoint.url,
      type: endpoint.type,
      weight: endpoint.weight,
      headers: endpoint.headers ? cloneHeaders(endpoint.headers) : undefined,
    };
  }

  #publishState(force = false) {
    const snapshot = this.#buildStateSnapshot();
    this.#messenger.publish(NETWORK_STATE_TOPIC, snapshot, {
      force,
      compare: (prev?: NetworkState, next?: NetworkState) => {
        if (!prev || !next) return false;
        if (prev.activeChain !== next.activeChain) return false;
        if (prev.knownChains.length !== next.knownChains.length) return false;
        for (let i = 0; i < prev.knownChains.length; i += 1) {
          if (prev.knownChains[i]?.chainRef !== next.knownChains[i]?.chainRef) return false;
        }
        const prevKeys = Object.keys(prev.rpc);
        const nextKeys = Object.keys(next.rpc);
        if (prevKeys.length !== nextKeys.length) return false;
        for (let i = 0; i < prevKeys.length; i += 1) {
          if (prevKeys[i] !== nextKeys[i]) return false;
          const prevState = prev.rpc[prevKeys[i]!]!;
          const nextState = next.rpc[nextKeys[i]!]!;
          if (prevState.activeIndex !== nextState.activeIndex) return false;
          if (prevState.lastUpdatedAt !== nextState.lastUpdatedAt) return false;
        }
        return true;
      },
    });

    const activeRuntime = this.#requireRuntime(this.#activeChain);
    this.#messenger.publish(NETWORK_CHAIN_TOPIC, cloneChainMetadata(activeRuntime.metadata), {
      force,
      compare: (prev?: ChainMetadata, next?: ChainMetadata) => prev?.chainRef === next?.chainRef,
    });
  }

  #publishEndpointChange(chainRef: ChainRef, previous: RpcEndpointInfo, next: RpcEndpointInfo) {
    this.#messenger.publish(NETWORK_RPC_ENDPOINT_TOPIC, { chainRef, previous, next }, { force: true });
  }

  #publishRpcHealth(chainRef: ChainRef, runtime: ChainRuntime) {
    this.#messenger.publish(
      NETWORK_RPC_HEALTH_TOPIC,
      { chainRef, state: this.#buildEndpointState(chainRef, runtime) },
      { force: true },
    );
  }

  #requireRuntime(chainRef: ChainRef): ChainRuntime {
    const runtime = this.#chains.get(chainRef);
    if (!runtime) {
      throw new Error(`Unknown chain: ${chainRef}`);
    }
    if (runtime.endpoints.length === 0) {
      throw new Error(`Chain ${chainRef} has no registered RPC endpoints`);
    }
    return runtime;
  }
}
