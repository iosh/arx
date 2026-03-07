import { chainErrors } from "../../chains/errors.js";
import type { ChainRef } from "../../chains/ids.js";
import type { RpcEndpoint } from "../../chains/metadata.js";
import { cloneRpcEndpoints, cloneRpcHeaders, fingerprintRpcEndpoints } from "./config.js";
import type { NetworkMessenger } from "./topics.js";
import {
  NETWORK_ACTIVE_CHAIN_CHANGED,
  NETWORK_CHAIN_CONFIG_CHANGED,
  NETWORK_RPC_ENDPOINT_CHANGED,
  NETWORK_RPC_HEALTH_CHANGED,
  NETWORK_STATE_CHANGED,
} from "./topics.js";
import type {
  ChainConfigChange,
  NetworkChainConfig,
  NetworkController,
  NetworkRuntimeInput,
  NetworkState,
  RpcEndpointChange,
  RpcEndpointHealth,
  RpcEndpointInfo,
  RpcEventLogger,
  RpcLogEvent,
  RpcOutcomeReport,
  RpcRoutingState,
  RpcStrategyConfig,
} from "./types.js";

const DEFAULT_STRATEGY: RpcStrategyConfig = { id: "round-robin" };
const defaultLogger: RpcEventLogger = () => {};

type NetworkControllerOptions = {
  messenger: NetworkMessenger;
  initialRuntime: NetworkRuntimeInput;
  defaultStrategy?: RpcStrategyConfig;
  now?: () => number;
  logger?: RpcEventLogger;
  defaultCooldownMs?: number;
};

type ChainRuntime = {
  endpoints: RpcEndpoint[];
  configFingerprint: string;
  routing: RpcRoutingState;
  health: RpcEndpointHealth[];
};

const sortChainRefs = (chainRefs: ChainRef[]) => [...chainRefs].sort((a, b) => a.localeCompare(b));

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

const deriveStrategyConfig = (strategy?: RpcStrategyConfig): RpcStrategyConfig => {
  if (!strategy) return { ...DEFAULT_STRATEGY };
  return { id: strategy.id, options: strategy.options ? { ...strategy.options } : undefined };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const stableStringifyJson = (value: unknown, seen?: Set<unknown>): string => {
  const stack = seen ?? new Set<unknown>();

  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const valueType = typeof value;
  if (valueType === "bigint") {
    return JSON.stringify(`__bigint__:${(value as bigint).toString(10)}`);
  }
  if (valueType === "string" || valueType === "number" || valueType === "boolean") return JSON.stringify(value);
  if (valueType === "function" || valueType === "symbol") return "undefined";
  if (valueType !== "object") return JSON.stringify(value);

  if (stack.has(value)) {
    return JSON.stringify("[Circular]");
  }
  stack.add(value);

  try {
    if (Array.isArray(value)) {
      const items = value.map((entry) => {
        if (entry === undefined) return "null";
        const entryType = typeof entry;
        if (entryType === "function" || entryType === "symbol") return "null";
        return stableStringifyJson(entry, stack);
      });
      return `[${items.join(",")}]`;
    }

    if (!isPlainObject(value)) {
      const json = JSON.stringify(value);
      return json === undefined ? "undefined" : json;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const props: string[] = [];
    for (const key of keys) {
      const nextValue = record[key];
      if (nextValue === undefined) continue;
      const nextValueType = typeof nextValue;
      if (nextValueType === "function" || nextValueType === "symbol") continue;
      props.push(`${JSON.stringify(key)}:${stableStringifyJson(nextValue, stack)}`);
    }
    return `{${props.join(",")}}`;
  } catch {
    return JSON.stringify(Object.prototype.toString.call(value));
  } finally {
    stack.delete(value);
  }
};

const isSameStrategy = (previous: RpcStrategyConfig, next: RpcStrategyConfig) => {
  if (previous.id !== next.id) return false;
  return stableStringifyJson(previous.options ?? null) === stableStringifyJson(next.options ?? null);
};

const isSameRpcEndpoints = (a: readonly RpcEndpoint[], b: readonly RpcEndpoint[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.url !== b[i]?.url) return false;
  }
  return true;
};

export class InMemoryNetworkController implements NetworkController {
  #messenger: NetworkMessenger;
  #chains = new Map<ChainRef, ChainRuntime>();
  #activeChain: ChainRef;
  #defaultStrategy: RpcStrategyConfig;
  #now: () => number;
  #logger: RpcEventLogger;
  #defaultCooldownMs: number;
  #revision = 0;

  constructor({
    messenger,
    initialRuntime,
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
    this.#activeChain = initialRuntime.state.activeChainRef;

    this.replaceState(initialRuntime);
  }

  getState(): NetworkState {
    return this.#buildStateSnapshot();
  }

  getActiveEndpoint(chainRef?: ChainRef): RpcEndpointInfo {
    const resolvedChainRef = chainRef ?? this.#activeChain;
    const runtime = this.#requireRuntime(resolvedChainRef);
    const endpoints = runtime.endpoints;
    if (endpoints.length === 0) {
      throw new Error(`Chain ${resolvedChainRef} has no registered RPC endpoints`);
    }

    const index = runtime.routing.activeIndex;
    const endpoint = endpoints[index];
    if (!endpoint) {
      throw new Error(`Active endpoint index ${index} is out of bounds for ${resolvedChainRef}`);
    }
    return {
      index,
      url: endpoint.url,
      type: endpoint.type,
      weight: endpoint.weight,
      headers: endpoint.headers ? cloneRpcHeaders(endpoint.headers) : undefined,
    };
  }

  onStateChanged(handler: (state: NetworkState) => void): () => void {
    return this.#messenger.subscribe(NETWORK_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onActiveChainChanged(handler: (payload: { previous: ChainRef; next: ChainRef }) => void): () => void {
    return this.#messenger.subscribe(NETWORK_ACTIVE_CHAIN_CHANGED, handler);
  }

  onChainConfigChanged(handler: (payload: ChainConfigChange) => void): () => void {
    return this.#messenger.subscribe(NETWORK_CHAIN_CONFIG_CHANGED, handler);
  }

  onRpcEndpointChanged(handler: (change: RpcEndpointChange) => void): () => void {
    return this.#messenger.subscribe(NETWORK_RPC_ENDPOINT_CHANGED, handler);
  }

  onRpcHealthChanged(handler: (update: { chainRef: ChainRef; health: RpcEndpointHealth[] }) => void): () => void {
    return this.#messenger.subscribe(NETWORK_RPC_HEALTH_CHANGED, handler);
  }

  async switchChain(target: ChainRef): Promise<void> {
    if (this.#activeChain === target) {
      return;
    }
    if (!this.#chains.has(target)) {
      throw chainErrors.notAvailable({ chainRef: target });
    }

    const previous = this.#activeChain;
    this.#activeChain = target;
    this.#touch();
    this.#publishState();
    this.#publishActiveChainChanged(previous, target);
  }

  reportRpcOutcome(chainRef: ChainRef, outcome: RpcOutcomeReport): void {
    const runtime = this.#requireRuntime(chainRef);
    const endpoints = runtime.endpoints;
    if (endpoints.length === 0) {
      throw new Error(`Cannot report RPC outcome for chain ${chainRef} without endpoints`);
    }

    const now = this.#now();
    const targetIndex = this.#selectEndpointIndex(runtime, outcome.endpointIndex);
    const previousIndex = runtime.routing.activeIndex;
    const health = runtime.health[targetIndex];
    if (!health) {
      throw new Error(`Invariant violation: missing RPC health entry for chain ${chainRef} index ${targetIndex}`);
    }

    const targetEndpoint = this.#buildEndpointInfo(chainRef, runtime, targetIndex);

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

      this.#publishRpcHealth(chainRef, runtime);

      if (cumulativeFailures > 0) {
        const recoveryMs = typeof lastFailureAt === "number" ? Math.max(0, now - lastFailureAt) : undefined;
        const recoveryEvent: RpcLogEvent = {
          level: "info",
          event: "rpcRecovery",
          chainRef,
          endpoint: targetEndpoint,
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

    const nextIndex = this.#selectNextEndpoint(chainRef, runtime, now, targetIndex);
    const endpointChanged = nextIndex !== previousIndex;
    if (endpointChanged) {
      runtime.routing.activeIndex = nextIndex;
    }

    const nextEndpoint = this.#buildEndpointInfo(chainRef, runtime, runtime.routing.activeIndex);

    this.#logger({
      level: endpointChanged ? "warn" : "info",
      event: "rpcFailure",
      chainRef,
      endpoint: targetEndpoint,
      nextEndpoint,
      consecutiveFailures: health.consecutiveFailures,
      error: {
        message: outcome.error.message,
        code: outcome.error.code,
        data: outcome.error.data,
      },
    });

    this.#publishRpcHealth(chainRef, runtime);

    if (endpointChanged) {
      this.#touch();
      this.#publishState();
      this.#publishEndpointChange(chainRef, targetEndpoint, nextEndpoint);
    }
  }

  setStrategy(chainRef: ChainRef, strategy: RpcStrategyConfig): void {
    const runtime = this.#requireRuntime(chainRef);
    runtime.routing.strategy = deriveStrategyConfig(strategy);
    this.#logger({
      level: "info",
      event: "strategyChanged",
      chainRef,
      strategy: runtime.routing.strategy,
    });
    this.#touch();
    this.#publishState();
  }

  replaceState(input: NetworkRuntimeInput): void {
    const { state, chainConfigs } = input;

    if (!state.availableChainRefs.some((chainRef) => chainRef === state.activeChainRef)) {
      throw new Error(`Active chain ${state.activeChainRef} must be present in availableChainRefs`);
    }

    const chainConfigMap = new Map<ChainRef, NetworkChainConfig>();
    for (const config of chainConfigs) {
      if (chainConfigMap.has(config.chainRef)) {
        throw new Error(`Duplicate network chain config for ${config.chainRef}`);
      }
      chainConfigMap.set(config.chainRef, {
        chainRef: config.chainRef,
        rpcEndpoints: cloneRpcEndpoints(config.rpcEndpoints),
      });
    }

    const previousActive = this.#activeChain;
    const previousRuntimes = this.#chains;
    let stateChanged = false;
    const pendingConfigChanges = new Set<ChainRef>();

    const nextChains = new Map<ChainRef, ChainRuntime>();
    for (const chainRef of sortChainRefs([...state.availableChainRefs])) {
      const prev = previousRuntimes.get(chainRef) ?? null;
      const chainConfig = chainConfigMap.get(chainRef);
      if (!chainConfig) {
        throw new Error(`Network state for ${chainRef} is missing chain config`);
      }

      const endpoints = cloneRpcEndpoints(chainConfig.rpcEndpoints);
      if (endpoints.length === 0) {
        throw new Error(`Chain ${chainRef} must expose at least one RPC endpoint`);
      }

      const desiredRouting: RpcRoutingState = {
        activeIndex: state.rpc[chainRef]?.activeIndex ?? 0,
        strategy: deriveStrategyConfig(
          state.rpc[chainRef]?.strategy ?? prev?.routing.strategy ?? this.#defaultStrategy,
        ),
      };

      desiredRouting.activeIndex = Math.min(desiredRouting.activeIndex, Math.max(0, endpoints.length - 1));

      const health =
        prev && isSameRpcEndpoints(prev.endpoints, endpoints) && prev.health.length === endpoints.length
          ? cloneHealth(prev.health)
          : this.#initialiseHealth(endpoints.length);

      const nextRuntime: ChainRuntime = {
        endpoints,
        configFingerprint: fingerprintRpcEndpoints(endpoints),
        routing: desiredRouting,
        health,
      };
      nextChains.set(chainRef, nextRuntime);

      const previousFingerprint = prev?.configFingerprint ?? null;
      if (!previousFingerprint || previousFingerprint !== nextRuntime.configFingerprint) {
        stateChanged = true;
        pendingConfigChanges.add(chainRef);
      }

      if (
        prev &&
        (prev.routing.activeIndex !== nextRuntime.routing.activeIndex ||
          !isSameStrategy(prev.routing.strategy, nextRuntime.routing.strategy))
      ) {
        stateChanged = true;
      }
    }

    for (const [chainRef] of previousRuntimes.entries()) {
      if (!nextChains.has(chainRef)) {
        stateChanged = true;
        pendingConfigChanges.add(chainRef);
      }
    }

    this.#chains = nextChains;
    this.#activeChain = state.activeChainRef;

    if (previousActive !== this.#activeChain) {
      stateChanged = true;
    }

    if (stateChanged) {
      this.#touch();
      this.#publishState();
    }

    for (const chainRef of pendingConfigChanges) {
      this.#publishChainConfigChanged(chainRef);
    }

    if (previousActive !== this.#activeChain) {
      this.#publishActiveChainChanged(previousActive, this.#activeChain);
    }
  }

  #touch() {
    this.#revision += 1;
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
      return runtime.routing.activeIndex;
    }
    const total = runtime.endpoints.length;
    if (provided < 0 || provided >= total) {
      return runtime.routing.activeIndex;
    }
    return provided;
  }

  #selectNextEndpoint(chainRef: ChainRef, runtime: ChainRuntime, now: number, failedIndex: number): number {
    const total = runtime.endpoints.length;
    if (total <= 1) return 0;

    const strategyId = runtime.routing.strategy.id ?? "round-robin";
    if (strategyId !== "round-robin") {
      // Placeholder for future strategy expansion.
    }

    let candidate = (failedIndex + 1) % total;
    for (let attempts = 0; attempts < total; attempts += 1) {
      const health = runtime.health[candidate];
      if (!health) {
        throw new Error(`Invariant violation: missing RPC health entry for chain ${chainRef} index ${candidate}`);
      }
      if (!health.cooldownUntil || health.cooldownUntil <= now) {
        return candidate;
      }
      candidate = (candidate + 1) % total;
    }

    const failedHealth = runtime.health[failedIndex];
    if (!failedHealth) {
      throw new Error(`Invariant violation: missing RPC health entry for chain ${chainRef} index ${failedIndex}`);
    }
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
    const rpcEntries = Array.from(this.#chains.entries()).map(([chainRef, runtime]) => {
      const routing: RpcRoutingState = {
        activeIndex: runtime.routing.activeIndex,
        strategy: deriveStrategyConfig(runtime.routing.strategy),
      };
      return [chainRef, routing] as const;
    });
    rpcEntries.sort((a, b) => a[0].localeCompare(b[0]));

    return {
      revision: this.#revision,
      activeChainRef: this.#activeChain,
      availableChainRefs: sortChainRefs(Array.from(this.#chains.keys())),
      rpc: Object.fromEntries(rpcEntries),
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
      headers: endpoint.headers ? cloneRpcHeaders(endpoint.headers) : undefined,
    };
  }

  #publishState(force = false) {
    const snapshot = this.#buildStateSnapshot();
    this.#messenger.publish(NETWORK_STATE_CHANGED, snapshot, { force });
  }

  #publishActiveChainChanged(previous: ChainRef, next: ChainRef) {
    this.#messenger.publish(NETWORK_ACTIVE_CHAIN_CHANGED, { previous, next }, { force: true });
  }

  #publishChainConfigChanged(chainRef: ChainRef) {
    this.#messenger.publish(NETWORK_CHAIN_CONFIG_CHANGED, { chainRef }, { force: true });
  }

  #publishEndpointChange(chainRef: ChainRef, previous: RpcEndpointInfo, next: RpcEndpointInfo) {
    this.#messenger.publish(NETWORK_RPC_ENDPOINT_CHANGED, { chainRef, previous, next }, { force: true });
  }

  #publishRpcHealth(chainRef: ChainRef, runtime: ChainRuntime) {
    this.#messenger.publish(
      NETWORK_RPC_HEALTH_CHANGED,
      { chainRef, health: cloneHealth(runtime.health) },
      { force: true },
    );
  }

  #requireRuntime(chainRef: ChainRef): ChainRuntime {
    const runtime = this.#chains.get(chainRef);
    if (!runtime) {
      throw chainErrors.notAvailable({ chainRef });
    }
    if (runtime.endpoints.length === 0) {
      throw new Error(`Chain ${chainRef} has no registered RPC endpoints`);
    }
    return runtime;
  }
}
