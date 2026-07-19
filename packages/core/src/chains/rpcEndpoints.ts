import type { ChainRef } from "../networks/chainRef.js";
import type { BuiltinNetworkSeed, NonEmptyRpcEndpoints } from "../networks/types.js";
import { ChainRpcAccessConfigError } from "./errors.js";
import type { ChainRpcOverrideRecord, CustomChainRecord } from "./persistence.js";
import { assertNonEmptyRpcEndpoints, cloneNonEmptyRpcEndpoints } from "./rpc/config.js";

/** Owns default RPC endpoints and user overrides for available chains. */
export class RpcEndpoints {
  readonly #defaults = new Map<ChainRef, NonEmptyRpcEndpoints>();
  readonly #overrides = new Map<ChainRef, NonEmptyRpcEndpoints>();

  constructor(params: {
    builtinSeeds: readonly BuiltinNetworkSeed[];
    customChains: readonly CustomChainRecord[];
    overrides: readonly ChainRpcOverrideRecord[];
  }) {
    for (const seed of params.builtinSeeds) {
      this.#defaults.set(
        seed.definition.chainRef,
        assertNonEmptyRpcEndpoints(seed.definition.chainRef, seed.defaultRpcEndpoints),
      );
    }
    for (const record of params.customChains) {
      this.#defaults.set(record.definition.chainRef, cloneNonEmptyRpcEndpoints(record.defaultRpcEndpoints));
    }
    for (const record of params.overrides) {
      this.#overrides.set(record.chainRef, cloneNonEmptyRpcEndpoints(record.endpoints));
    }
  }

  getEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints {
    const endpoints = this.#overrides.get(chainRef) ?? this.#defaults.get(chainRef);
    if (!endpoints) throw new ChainRpcAccessConfigError({ chainRef, reason: "missing_endpoints" });
    return cloneNonEmptyRpcEndpoints(endpoints);
  }

  getOverride(chainRef: ChainRef): ChainRpcOverrideRecord | null {
    const endpoints = this.#overrides.get(chainRef);
    return endpoints ? { chainRef, endpoints: cloneNonEmptyRpcEndpoints(endpoints) } : null;
  }

  replaceCustomDefaults(record: CustomChainRecord): void {
    this.#defaults.set(record.definition.chainRef, cloneNonEmptyRpcEndpoints(record.defaultRpcEndpoints));
  }

  removeCustomChain(chainRef: ChainRef): void {
    this.#defaults.delete(chainRef);
    this.#overrides.delete(chainRef);
  }

  replaceOverride(record: ChainRpcOverrideRecord): void {
    this.#overrides.set(record.chainRef, cloneNonEmptyRpcEndpoints([...record.endpoints]));
  }

  removeOverride(chainRef: ChainRef): void {
    this.#overrides.delete(chainRef);
  }
}
