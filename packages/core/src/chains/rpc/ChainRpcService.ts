import type { Messenger } from "../../messenger/index.js";
import { ChainNotAvailableError, ChainRpcAccessConfigError } from "../errors.js";
import type { ChainRef } from "../ids.js";
import { areRpcEndpointsEqual, cloneChainRpcAccess, cloneNonEmptyRpcEndpoints } from "./config.js";
import { CHAIN_RPC_ENDPOINTS_CHANGED, CHAIN_RPC_STATE_CHANGED } from "./topics.js";
import type {
  ChainRpcAccess,
  ChainRpcAccessUpdater,
  ChainRpcEndpointsChangedEvent,
  ChainRpcReader,
  ChainRpcState,
  NonEmptyRpcEndpoints,
} from "./types.js";

type ChainRpcServiceOptions = {
  messenger: Messenger;
  initialAccesses: readonly ChainRpcAccess[];
};

const sortChainRefs = (chainRefs: ChainRef[]) => [...chainRefs].sort((a, b) => a.localeCompare(b));

const sortAccesses = (accesses: ChainRpcAccess[]): ChainRpcAccess[] =>
  [...accesses].sort((a, b) => a.chainRef.localeCompare(b.chainRef));

const buildAccessMap = (accesses: readonly ChainRpcAccess[]) => {
  const next = new Map<ChainRef, ChainRpcAccess>();
  for (const access of accesses) {
    if (next.has(access.chainRef)) {
      throw new ChainRpcAccessConfigError({ chainRef: access.chainRef, reason: "duplicate" });
    }
    next.set(access.chainRef, cloneChainRpcAccess(access));
  }
  return next;
};

export class ChainRpcService implements ChainRpcReader, ChainRpcAccessUpdater {
  #messenger: Messenger;
  #accessByChainRef = new Map<ChainRef, ChainRpcAccess>();

  constructor({ messenger, initialAccesses }: ChainRpcServiceOptions) {
    this.#messenger = messenger;
    this.replaceAccesses(initialAccesses);
  }

  getState(): ChainRpcState {
    return this.#buildStateSnapshot();
  }

  hasEndpoints(chainRef: ChainRef): boolean {
    return this.#accessByChainRef.has(chainRef);
  }

  listChainRefs(): ChainRef[] {
    return sortChainRefs(Array.from(this.#accessByChainRef.keys()));
  }

  listAccesses(): ChainRpcAccess[] {
    return sortAccesses(Array.from(this.#accessByChainRef.values()).map((access) => cloneChainRpcAccess(access)));
  }

  getEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints {
    const access = this.#accessByChainRef.get(chainRef);
    if (!access) {
      throw new ChainNotAvailableError();
    }
    return cloneNonEmptyRpcEndpoints(access.endpoints);
  }

  onStateChanged(handler: (state: ChainRpcState) => void): () => void {
    return this.#messenger.subscribe(CHAIN_RPC_STATE_CHANGED, handler);
  }

  onEndpointsChanged(handler: (event: ChainRpcEndpointsChangedEvent) => void): () => void {
    return this.#messenger.subscribe(CHAIN_RPC_ENDPOINTS_CHANGED, handler);
  }

  replaceAccesses(accesses: readonly ChainRpcAccess[]): void {
    const previous = this.#accessByChainRef;
    const next = buildAccessMap(accesses);
    const changedChainRefs = new Set<ChainRef>();

    for (const [chainRef, access] of next) {
      const previousAccess = previous.get(chainRef);
      if (!previousAccess || !areRpcEndpointsEqual(previousAccess.endpoints, access.endpoints)) {
        changedChainRefs.add(chainRef);
      }
    }

    for (const chainRef of previous.keys()) {
      if (!next.has(chainRef)) {
        changedChainRefs.add(chainRef);
      }
    }

    this.#accessByChainRef = next;

    if (changedChainRefs.size === 0) {
      return;
    }

    this.#publishState();

    for (const chainRef of sortChainRefs(Array.from(changedChainRefs))) {
      this.#messenger.publish(CHAIN_RPC_ENDPOINTS_CHANGED, { chainRef });
    }
  }

  #buildStateSnapshot(): ChainRpcState {
    return {
      accesses: this.listAccesses(),
    };
  }

  #publishState() {
    this.#messenger.publish(CHAIN_RPC_STATE_CHANGED, this.#buildStateSnapshot());
  }
}
