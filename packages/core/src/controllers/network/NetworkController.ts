import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata, RpcEndpoint } from "../../chains/metadata.js";
import { cloneChainMetadata } from "../../chains/metadata.js";
import type { NetworkMessenger } from "./topics.js";
import {
  NETWORK_ACTIVE_CHAIN_CHANGED,
  NETWORK_CHAIN_METADATA_CHANGED,
  NETWORK_RPC_ENDPOINT_CHANGED,
  NETWORK_RPC_HEALTH_CHANGED,
  NETWORK_STATE_CHANGED,
} from "./topics.js";
import type {
  NetworkController,
  NetworkState,
  NetworkStateInput,
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
  initialState: NetworkStateInput;
  defaultStrategy?: RpcStrategyConfig;
  now?: () => number;
  logger?: RpcEventLogger;
  defaultCooldownMs?: number;
};

type ChainRuntime = {
  metadata: ChainMetadata;
  // Used to detect registry-driven metadata changes deterministically.
  metadataFingerprint: string;
  routing: RpcRoutingState;
  health: RpcEndpointHealth[];
};

const cloneHeaders = (headers?: Record<string, string>) => {
  if (!headers) return undefined;
  return Object.fromEntries(Object.entries(headers));
};

const sortChains = (chains: ChainMetadata[]) => [...chains].sort((a, b) => a.chainRef.localeCompare(b.chainRef));

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
  // Deterministic JSON-ish stringify for comparisons/fingerprints.
  // - Sorts plain-object keys.
  // - Omits undefined/function/symbol object fields (like JSON.stringify).
  // - Converts undefined/function/symbol array entries to null (like JSON.stringify).
  // - Handles bigint without throwing.
  const stack = seen ?? new Set<unknown>();

  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const t = typeof value;
  if (t === "bigint") {
    return JSON.stringify(`__bigint__:${(value as bigint).toString(10)}`);
  }
  if (t === "string" || t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "function" || t === "symbol") return "undefined";
  if (t !== "object") return JSON.stringify(value);

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
      // Align with JSON.stringify semantics for Date / class instances / etc.
      const json = JSON.stringify(value);
      return json === undefined ? "undefined" : json;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const props: string[] = [];
    for (const key of keys) {
      const v = record[key];
      if (v === undefined) continue;
      const vt = typeof v;
      if (vt === "function" || vt === "symbol") continue;
      props.push(`${JSON.stringify(key)}:${stableStringifyJson(v, stack)}`);
    }
    return `{${props.join(",")}}`;
  } catch {
    // Last-resort fallback (e.g. unknown non-JSON value).
    return JSON.stringify(Object.prototype.toString.call(value));
  } finally {
    stack.delete(value);
  }
};

const fingerprintMetadata = (metadata: ChainMetadata): string => {
  return stableStringifyJson(cloneChainMetadata(metadata));
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

    this.replaceState(initialState);
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

  getActiveEndpoint(chainRef?: ChainRef): RpcEndpointInfo {
    const runtime = this.#requireRuntime(chainRef ?? this.#activeChain);
    const endpoints = runtime.metadata.rpcEndpoints;
    if (endpoints.length === 0) {
      throw new Error(`Chain ${runtime.metadata.chainRef} has no registered RPC endpoints`);
    }

    const index = runtime.routing.activeIndex;
    const endpoint = endpoints[index];
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
    return this.#messenger.subscribe(NETWORK_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onActiveChainChanged(handler: (payload: { previous: ChainRef; next: ChainRef }) => void): () => void {
    return this.#messenger.subscribe(NETWORK_ACTIVE_CHAIN_CHANGED, handler);
  }

  onChainMetadataChanged(
    handler: (payload: { chainRef: ChainRef; previous: ChainMetadata | null; next: ChainMetadata | null }) => void,
  ): () => void {
    return this.#messenger.subscribe(NETWORK_CHAIN_METADATA_CHANGED, handler);
  }

  onRpcEndpointChanged(handler: (change: RpcEndpointChange) => void): () => void {
    return this.#messenger.subscribe(NETWORK_RPC_ENDPOINT_CHANGED, handler);
  }

  onRpcHealthChanged(handler: (update: { chainRef: ChainRef; health: RpcEndpointHealth[] }) => void): () => void {
    return this.#messenger.subscribe(NETWORK_RPC_HEALTH_CHANGED, handler);
  }

  async switchChain(target: ChainRef): Promise<ChainMetadata> {
    if (this.#activeChain === target) {
      return this.getActiveChain();
    }
    const runtime = this.#chains.get(target);
    if (!runtime) {
      throw new Error(`Unknown chain: ${target}`);
    }

    const previous = this.#activeChain;
    this.#activeChain = target;
    this.#touch();
    this.#publishState();
    this.#publishActiveChainChanged(previous, target);

    return cloneChainMetadata(runtime.metadata);
  }

  reportRpcOutcome(chainRef: ChainRef, outcome: RpcOutcomeReport): void {
    const runtime = this.#requireRuntime(chainRef);
    const endpoints = runtime.metadata.rpcEndpoints;
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

    const nextIndex = this.#selectNextEndpoint(runtime, now, targetIndex);
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

    // Health always changes on failures.
    this.#publishRpcHealth(chainRef, runtime);

    // Only publish state/endpoints when routing changes.
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

  replaceState(state: NetworkStateInput): void {
    if (!state.knownChains.some((chain) => chain.chainRef === state.activeChain)) {
      throw new Error(`Active chain ${state.activeChain} must be present in knownChains`);
    }

    const previousActive = this.#activeChain;
    const previousRuntimes = this.#chains;
    let stateChanged = false;
    const pendingMetadataEvents: Array<{
      chainRef: ChainRef;
      previous: ChainMetadata | null;
      next: ChainMetadata | null;
    }> = [];

    const nextChains = new Map<ChainRef, ChainRuntime>();
    for (const metadata of sortChains(state.knownChains.map(cloneChainMetadata))) {
      const chainRef = metadata.chainRef;
      const prev = previousRuntimes.get(chainRef) ?? null;

      const desiredRouting: RpcRoutingState = {
        activeIndex: state.rpc[chainRef]?.activeIndex ?? 0,
        strategy: deriveStrategyConfig(
          state.rpc[chainRef]?.strategy ?? prev?.routing.strategy ?? this.#defaultStrategy,
        ),
      };

      const endpoints = metadata.rpcEndpoints;
      if (endpoints.length === 0) {
        throw new Error(`Chain ${chainRef} must expose at least one RPC endpoint`);
      }

      const safeIndex = Math.min(desiredRouting.activeIndex, Math.max(0, endpoints.length - 1));
      desiredRouting.activeIndex = safeIndex;

      const health =
        prev &&
        isSameRpcEndpoints(prev.metadata.rpcEndpoints, metadata.rpcEndpoints) &&
        prev.health.length === endpoints.length
          ? cloneHealth(prev.health)
          : this.#initialiseHealth(endpoints.length);

      const nextRuntime: ChainRuntime = {
        metadata,
        metadataFingerprint: fingerprintMetadata(metadata),
        routing: desiredRouting,
        health,
      };
      nextChains.set(chainRef, nextRuntime);

      const previousFingerprint = prev?.metadataFingerprint ?? null;
      if (!previousFingerprint) {
        stateChanged = true;
        pendingMetadataEvents.push({ chainRef, previous: null, next: metadata });
      } else if (prev && previousFingerprint !== nextRuntime.metadataFingerprint) {
        stateChanged = true;
        pendingMetadataEvents.push({ chainRef, previous: prev.metadata, next: metadata });
      }

      if (
        prev &&
        (prev.routing.activeIndex !== nextRuntime.routing.activeIndex ||
          !isSameStrategy(prev.routing.strategy, nextRuntime.routing.strategy))
      ) {
        stateChanged = true;
      }
    }

    for (const [chainRef, prev] of previousRuntimes.entries()) {
      if (!nextChains.has(chainRef)) {
        stateChanged = true;
        pendingMetadataEvents.push({ chainRef, previous: prev.metadata, next: null });
      }
    }

    this.#chains = nextChains;
    this.#activeChain = state.activeChain;

    if (previousActive !== this.#activeChain) {
      stateChanged = true;
    }

    if (stateChanged) {
      this.#touch();
      this.#publishState();
    }

    for (const event of pendingMetadataEvents) {
      this.#publishChainMetadataChanged(event.chainRef, event.previous, event.next);
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
    const total = runtime.metadata.rpcEndpoints.length;
    if (provided < 0 || provided >= total) {
      return runtime.routing.activeIndex;
    }
    return provided;
  }

  #selectNextEndpoint(runtime: ChainRuntime, now: number, failedIndex: number): number {
    const total = runtime.metadata.rpcEndpoints.length;
    if (total <= 1) return 0;

    const strategyId = runtime.routing.strategy.id ?? "round-robin";
    if (strategyId !== "round-robin") {
      // Placeholder for future strategy expansion.
    }

    let candidate = (failedIndex + 1) % total;
    for (let attempts = 0; attempts < total; attempts += 1) {
      const health = runtime.health[candidate];
      if (!health) {
        throw new Error(
          `Invariant violation: missing RPC health entry for chain ${runtime.metadata.chainRef} index ${candidate}`,
        );
      }
      if (!health.cooldownUntil || health.cooldownUntil <= now) {
        return candidate;
      }
      candidate = (candidate + 1) % total;
    }

    const failedHealth = runtime.health[failedIndex];
    if (!failedHealth) {
      throw new Error(
        `Invariant violation: missing RPC health entry for chain ${runtime.metadata.chainRef} index ${failedIndex}`,
      );
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
    const knownChains = sortChains(
      Array.from(this.#chains.values(), (runtime) => cloneChainMetadata(runtime.metadata)),
    );
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
      activeChain: this.#activeChain,
      knownChains,
      rpc: Object.fromEntries(rpcEntries),
    };
  }

  #buildEndpointInfo(chainRef: ChainRef, runtime: ChainRuntime, index: number): RpcEndpointInfo {
    const endpoint = runtime.metadata.rpcEndpoints[index];
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
    this.#messenger.publish(NETWORK_STATE_CHANGED, snapshot, { force });
  }

  #publishActiveChainChanged(previous: ChainRef, next: ChainRef) {
    this.#messenger.publish(NETWORK_ACTIVE_CHAIN_CHANGED, { previous, next }, { force: true });
  }

  #publishChainMetadataChanged(chainRef: ChainRef, previous: ChainMetadata | null, next: ChainMetadata | null) {
    this.#messenger.publish(
      NETWORK_CHAIN_METADATA_CHANGED,
      {
        chainRef,
        previous: previous ? cloneChainMetadata(previous) : null,
        next: next ? cloneChainMetadata(next) : null,
      },
      { force: true },
    );
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
      throw new Error(`Unknown chain: ${chainRef}`);
    }
    if (runtime.metadata.rpcEndpoints.length === 0) {
      throw new Error(`Chain ${chainRef} has no registered RPC endpoints`);
    }
    return runtime;
  }
}
