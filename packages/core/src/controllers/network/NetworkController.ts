import type { Caip2ChainId } from "../../chains/ids.js";
import type { ChainIcon, ChainMetadata, ExplorerLink, RpcEndpoint } from "../../chains/metadata.js";
import type {
  NetworkController,
  NetworkMessenger,
  NetworkRpcStatus,
  NetworkRpcStatusUpdate,
  NetworkState,
} from "./types.js";

const NETWORK_STATE_TOPIC = "network:stateChanged";
const NETWORK_CHAIN_TOPIC = "network:chainChanged";
const NETWORK_RPC_STATUS_TOPIC = "network:rpcStatusChanged";

export type NetworkControllerOptions = {
  messenger: NetworkMessenger;
  initialState: NetworkState;
  defaultRpcStatus?: NetworkRpcStatus;
};

const cloneRpcEndpoint = (endpoint: RpcEndpoint): RpcEndpoint => {
  const clone: RpcEndpoint = { url: endpoint.url };
  if (endpoint.type !== undefined) clone.type = endpoint.type;
  if (endpoint.weight !== undefined) clone.weight = endpoint.weight;
  if (endpoint.headers !== undefined) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(endpoint.headers)) {
      headers[key] = value;
    }
    clone.headers = headers;
  }
  return clone;
};

const cloneExplorerLink = (link: ExplorerLink): ExplorerLink => {
  const clone: ExplorerLink = { type: link.type, url: link.url };
  if (link.title !== undefined) clone.title = link.title;
  return clone;
};

const cloneIcon = (icon: ChainIcon): ChainIcon => {
  const clone: ChainIcon = { url: icon.url };
  if (icon.width !== undefined) clone.width = icon.width;
  if (icon.height !== undefined) clone.height = icon.height;
  if (icon.format !== undefined) clone.format = icon.format;
  return clone;
};

const makeExtensionsClone = (extensions?: Record<string, unknown>) => {
  if (!extensions) return undefined;
  const entries = Object.entries(extensions).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
};

const cloneMetadata = (metadata: ChainMetadata): ChainMetadata => {
  const clone: ChainMetadata = {
    chainRef: metadata.chainRef,
    namespace: metadata.namespace,
    displayName: metadata.displayName,
    nativeCurrency: {
      name: metadata.nativeCurrency.name,
      symbol: metadata.nativeCurrency.symbol,
      decimals: metadata.nativeCurrency.decimals,
    },
    rpcEndpoints: metadata.rpcEndpoints.map(cloneRpcEndpoint),
  };

  if (metadata.chainId !== undefined) clone.chainId = metadata.chainId;
  if (metadata.shortName !== undefined) clone.shortName = metadata.shortName;
  if (metadata.description !== undefined) clone.description = metadata.description;
  if (metadata.blockExplorers) clone.blockExplorers = metadata.blockExplorers.map(cloneExplorerLink);
  if (metadata.icon) clone.icon = cloneIcon(metadata.icon);
  if (metadata.features) clone.features = [...metadata.features];
  if (metadata.tags) clone.tags = [...metadata.tags];
  const extensions = makeExtensionsClone(metadata.extensions);
  if (extensions) clone.extensions = extensions;

  return clone;
};

const cloneRpcStatus = (status: NetworkRpcStatus): NetworkRpcStatus => {
  if (status.lastError === undefined) {
    return { endpointIndex: status.endpointIndex };
  }
  return { endpointIndex: status.endpointIndex, lastError: status.lastError };
};

const serializeRecord = (record?: Record<string, unknown>): string => {
  if (!record) return "";
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
};

const isSameStringRecord = (prev?: Record<string, string>, next?: Record<string, string>) => {
  return (
    serializeRecord(prev as Record<string, unknown> | undefined) ===
    serializeRecord(next as Record<string, unknown> | undefined)
  );
};

const compareOptionalArray = <T>(prev?: readonly T[], next?: readonly T[]) => {
  if (!prev && !next) return true;
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return false;
  }
  return true;
};

const compareExplorers = (prev?: readonly ExplorerLink[], next?: readonly ExplorerLink[]) => {
  if (!prev && !next) return true;
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const prevExplorer = prev[i]!;
    const nextExplorer = next[i]!;
    if (prevExplorer.type !== nextExplorer.type) return false;
    if (prevExplorer.url !== nextExplorer.url) return false;
    if (prevExplorer.title !== nextExplorer.title) return false;
  }
  return true;
};

const compareIcon = (prev?: ChainIcon, next?: ChainIcon) => {
  if (!prev && !next) return true;
  if (!prev || !next) return false;
  return (
    prev.url === next.url && prev.width === next.width && prev.height === next.height && prev.format === next.format
  );
};

const compareExtensions = (prev?: Record<string, unknown>, next?: Record<string, unknown>) => {
  return serializeRecord(prev) === serializeRecord(next);
};

const isSameMetadata = (prev?: ChainMetadata, next?: ChainMetadata) => {
  if (!prev || !next) return false;
  if (prev === next) return true;

  if (
    prev.chainRef !== next.chainRef ||
    prev.namespace !== next.namespace ||
    prev.chainId !== next.chainId ||
    prev.displayName !== next.displayName ||
    prev.shortName !== next.shortName ||
    prev.description !== next.description
  ) {
    return false;
  }

  if (
    prev.nativeCurrency.name !== next.nativeCurrency.name ||
    prev.nativeCurrency.symbol !== next.nativeCurrency.symbol ||
    prev.nativeCurrency.decimals !== next.nativeCurrency.decimals
  ) {
    return false;
  }

  if (prev.rpcEndpoints.length !== next.rpcEndpoints.length) return false;
  for (let i = 0; i < prev.rpcEndpoints.length; i += 1) {
    const prevEndpoint = prev.rpcEndpoints[i]!;
    const nextEndpoint = next.rpcEndpoints[i]!;
    if (prevEndpoint.url !== nextEndpoint.url) return false;
    if (prevEndpoint.type !== nextEndpoint.type) return false;
    if (prevEndpoint.weight !== nextEndpoint.weight) return false;
    if (!isSameStringRecord(prevEndpoint.headers, nextEndpoint.headers)) return false;
  }

  if (!compareExplorers(prev.blockExplorers, next.blockExplorers)) return false;
  if (!compareIcon(prev.icon, next.icon)) return false;
  if (!compareOptionalArray(prev.features, next.features)) return false;
  if (!compareOptionalArray(prev.tags, next.tags)) return false;
  if (!compareExtensions(prev.extensions, next.extensions)) return false;

  return true;
};

const sortChains = (chains: ChainMetadata[]) => {
  return [...chains].sort((a, b) => a.chainRef.localeCompare(b.chainRef));
};

const isSameMetadataList = (prev: ChainMetadata[], next: ChainMetadata[]) => {
  if (prev.length !== next.length) return false;
  const sortedPrev = sortChains(prev);
  const sortedNext = sortChains(next);

  for (let i = 0; i < sortedPrev.length; i += 1) {
    if (!isSameMetadata(sortedPrev[i], sortedNext[i])) return false;
  }

  return true;
};

const isSameRpcStatus = (prev?: NetworkRpcStatus, next?: NetworkRpcStatus) => {
  if (!prev || !next) return false;
  return prev.endpointIndex === next.endpointIndex && prev.lastError === next.lastError;
};

const isSameRpcStatusRecord = (
  prev: Record<Caip2ChainId, NetworkRpcStatus>,
  next: Record<Caip2ChainId, NetworkRpcStatus>,
) => {
  const prevKeys = Object.keys(prev).sort();
  const nextKeys = Object.keys(next).sort();
  if (prevKeys.length !== nextKeys.length) return false;
  for (let i = 0; i < prevKeys.length; i += 1) {
    if (prevKeys[i] !== nextKeys[i]) return false;
    const key = prevKeys[i]!;
    if (!isSameRpcStatus(prev[key], next[key])) return false;
  }
  return true;
};

const isSameRpcStatusUpdate = (prev?: NetworkRpcStatusUpdate, next?: NetworkRpcStatusUpdate) => {
  if (!prev || !next) return false;
  if (prev.chainRef !== next.chainRef) return false;
  return isSameRpcStatus(prev.status, next.status);
};

const isSameNetworkState = (prev?: NetworkState, next?: NetworkState) => {
  if (!prev || !next) return false;
  if (prev.activeChain !== next.activeChain) return false;
  if (!isSameMetadataList(prev.knownChains, next.knownChains)) return false;
  if (!isSameRpcStatusRecord(prev.rpcStatus, next.rpcStatus)) return false;
  return true;
};

const buildStateSnapshot = (
  activeChain: Caip2ChainId,
  chains: Map<Caip2ChainId, ChainMetadata>,
  rpcStatus: Map<Caip2ChainId, NetworkRpcStatus>,
): NetworkState => {
  const knownChains = sortChains(Array.from(chains.values(), (metadata) => cloneMetadata(metadata)));
  const statusEntries = Array.from(
    rpcStatus.entries(),
    ([chainRef, status]) => [chainRef, cloneRpcStatus(status)] as const,
  ).sort((a, b) => a[0].localeCompare(b[0]));
  return {
    activeChain,
    knownChains,
    rpcStatus: Object.fromEntries(statusEntries),
  };
};

export class InMemoryNetworkController implements NetworkController {
  #messenger: NetworkMessenger;
  #activeChain: Caip2ChainId;
  #chains = new Map<Caip2ChainId, ChainMetadata>();
  #rpcStatus = new Map<Caip2ChainId, NetworkRpcStatus>();
  #defaultRpcStatus: NetworkRpcStatus;

  constructor({ messenger, initialState, defaultRpcStatus }: NetworkControllerOptions) {
    this.#messenger = messenger;
    this.#defaultRpcStatus = defaultRpcStatus ? cloneRpcStatus(defaultRpcStatus) : { endpointIndex: 0 };
    this.#activeChain = initialState.activeChain;
    this.#applyState(initialState);
    this.#publishState(true);
    for (const [chainRef, status] of this.#rpcStatus.entries()) {
      this.#publishRpcStatus(chainRef, status, true);
    }
  }

  getState(): NetworkState {
    return buildStateSnapshot(this.#activeChain, this.#chains, this.#rpcStatus);
  }

  getActiveChain(): ChainMetadata {
    return cloneMetadata(this.#requireChain(this.#activeChain));
  }

  getChain(chainRef: Caip2ChainId): ChainMetadata | null {
    const chain = this.#chains.get(chainRef);
    return chain ? cloneMetadata(chain) : null;
  }

  onStateChanged(handler: (state: NetworkState) => void): () => void {
    return this.#messenger.subscribe(NETWORK_STATE_TOPIC, handler);
  }

  onChainChanged(handler: (chain: ChainMetadata) => void): () => void {
    return this.#messenger.subscribe(NETWORK_CHAIN_TOPIC, handler);
  }

  onRpcStatusChanged(handler: (update: NetworkRpcStatusUpdate) => void): () => void {
    return this.#messenger.subscribe(NETWORK_RPC_STATUS_TOPIC, handler);
  }

  async switchChain(target: Caip2ChainId): Promise<ChainMetadata> {
    if (this.#activeChain === target) {
      return this.getActiveChain();
    }
    const chain = this.#chains.get(target);
    if (!chain) {
      throw new Error(`Unknown chain: ${target}`);
    }
    this.#activeChain = target;
    this.#publishState();
    return cloneMetadata(chain);
  }

  async addChain(chain: ChainMetadata, options?: { activate?: boolean }): Promise<ChainMetadata> {
    const incoming = cloneMetadata(chain);
    const existing = this.#chains.get(incoming.chainRef);
    const metadataChanged = !existing || !isSameMetadata(existing, incoming);

    this.#chains.set(incoming.chainRef, incoming);

    if (!this.#rpcStatus.has(incoming.chainRef)) {
      this.#rpcStatus.set(incoming.chainRef, this.#createDefaultRpcStatus());
    }

    const shouldActivate = options?.activate ?? this.#activeChain === incoming.chainRef;
    const activeChanged = shouldActivate && this.#activeChain !== incoming.chainRef;

    if (activeChanged) {
      this.#activeChain = incoming.chainRef;
    }

    if (metadataChanged || activeChanged) {
      this.#publishState();
    }

    return cloneMetadata(incoming);
  }

  updateRpcStatus(chainRef: Caip2ChainId, status: NetworkRpcStatus): void {
    if (!this.#chains.has(chainRef)) {
      throw new Error(`Cannot update RPC status for unknown chain: ${chainRef}`);
    }
    const previous = this.#rpcStatus.get(chainRef);
    const incoming = cloneRpcStatus(status);

    if (previous && isSameRpcStatus(previous, incoming)) {
      return;
    }

    this.#rpcStatus.set(chainRef, incoming);
    this.#publishRpcStatus(chainRef, incoming);
    this.#publishState();
  }

  replaceState(state: NetworkState): void {
    this.#applyState(state);
    this.#publishState();
    for (const [chainRef, status] of this.#rpcStatus.entries()) {
      this.#publishRpcStatus(chainRef, status);
    }
  }

  #applyState(state: NetworkState) {
    const sortedChains = sortChains(state.knownChains.map(cloneMetadata));
    const chainMap = new Map<Caip2ChainId, ChainMetadata>();
    for (const metadata of sortedChains) {
      chainMap.set(metadata.chainRef, metadata);
    }

    if (!chainMap.has(state.activeChain)) {
      throw new Error(`Active chain ${state.activeChain} must be included in knownChains`);
    }

    const statusMap = new Map<Caip2ChainId, NetworkRpcStatus>();
    for (const chainRef of chainMap.keys()) {
      const status = state.rpcStatus[chainRef];
      statusMap.set(chainRef, status ? cloneRpcStatus(status) : this.#createDefaultRpcStatus());
    }

    this.#chains = chainMap;
    this.#rpcStatus = statusMap;
    this.#activeChain = state.activeChain;
  }

  #createDefaultRpcStatus(): NetworkRpcStatus {
    return cloneRpcStatus(this.#defaultRpcStatus);
  }

  #publishState(force = false) {
    const state = buildStateSnapshot(this.#activeChain, this.#chains, this.#rpcStatus);
    this.#messenger.publish(NETWORK_STATE_TOPIC, state, { compare: isSameNetworkState, force });

    const activeChain = this.#chains.get(this.#activeChain);
    if (activeChain) {
      this.#messenger.publish(NETWORK_CHAIN_TOPIC, cloneMetadata(activeChain), { compare: isSameMetadata, force });
    }
  }

  #publishRpcStatus(chainRef: Caip2ChainId, status: NetworkRpcStatus, force = false) {
    const update: NetworkRpcStatusUpdate = { chainRef, status: cloneRpcStatus(status) };
    this.#messenger.publish(NETWORK_RPC_STATUS_TOPIC, update, { compare: isSameRpcStatusUpdate, force });
  }

  #requireChain(chainRef: Caip2ChainId): ChainMetadata {
    const chain = this.#chains.get(chainRef);
    if (!chain) {
      throw new Error(`Unknown chain: ${chainRef}`);
    }
    return chain;
  }
}
