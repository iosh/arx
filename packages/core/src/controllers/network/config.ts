import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata, RpcEndpoint } from "../../chains/metadata.js";
import type {
  NetworkChainConfig,
  NetworkRuntimeInput,
  NetworkStateInput,
  RpcRoutingState,
  RpcStrategyConfig,
} from "./types.js";

export const cloneRpcHeaders = (headers?: Record<string, string>) => {
  if (!headers) return undefined;
  return Object.fromEntries(Object.entries(headers));
};

export const cloneRpcEndpoints = (endpoints: readonly RpcEndpoint[]): RpcEndpoint[] =>
  endpoints.map((endpoint) => ({
    url: endpoint.url,
    type: endpoint.type,
    weight: endpoint.weight,
    headers: endpoint.headers ? cloneRpcHeaders(endpoint.headers) : undefined,
  }));

export const cloneRpcStrategyConfig = (strategy: RpcStrategyConfig): RpcStrategyConfig => ({
  id: strategy.id,
  options: strategy.options ? { ...strategy.options } : undefined,
});

export const cloneRpcRoutingState = (routing: RpcRoutingState): RpcRoutingState => ({
  activeIndex: routing.activeIndex,
  strategy: cloneRpcStrategyConfig(routing.strategy),
});

export const cloneNetworkStateInput = (state: NetworkStateInput): NetworkStateInput => ({
  activeChainRef: state.activeChainRef,
  availableChainRefs: [...state.availableChainRefs],
  rpc: Object.fromEntries(
    Object.entries(state.rpc).map(([chainRef, routing]) => [chainRef, cloneRpcRoutingState(routing)]),
  ) as Record<ChainRef, RpcRoutingState>,
});

export const cloneNetworkChainConfig = (config: NetworkChainConfig): NetworkChainConfig => ({
  chainRef: config.chainRef,
  rpcEndpoints: cloneRpcEndpoints(config.rpcEndpoints),
});

export const createNetworkRuntimeInput = (params: {
  state: NetworkStateInput;
  chainConfigs: readonly NetworkChainConfig[];
}): NetworkRuntimeInput => ({
  state: cloneNetworkStateInput(params.state),
  chainConfigs: params.chainConfigs.map((config) => cloneNetworkChainConfig(config)),
});

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

export const fingerprintRpcEndpoints = (endpoints: readonly RpcEndpoint[]): string => {
  return stableStringifyJson(cloneRpcEndpoints(endpoints));
};

export const buildNetworkChainConfig = (
  metadata: Pick<ChainMetadata, "chainRef" | "rpcEndpoints">,
): NetworkChainConfig => ({
  chainRef: metadata.chainRef,
  rpcEndpoints: cloneRpcEndpoints(metadata.rpcEndpoints),
});

export const buildNetworkChainConfigs = (
  metadatas: ReadonlyArray<Pick<ChainMetadata, "chainRef" | "rpcEndpoints">>,
): NetworkChainConfig[] => metadatas.map((metadata) => buildNetworkChainConfig(metadata));

export const buildNetworkRuntimeInput = (
  state: NetworkStateInput,
  metadatas: ReadonlyArray<Pick<ChainMetadata, "chainRef" | "rpcEndpoints">>,
): NetworkRuntimeInput =>
  createNetworkRuntimeInput({
    state,
    chainConfigs: buildNetworkChainConfigs(metadatas),
  });
