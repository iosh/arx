import { type ChainDefinition, type ChainDefinitionSeed, cloneChainDefinition } from "./definition.js";
import { ChainDefinitionConflictError, DuplicateBuiltinChainDefinitionError } from "./errors.js";
import type { ChainRef } from "./ids.js";
import type { CustomChainRecord } from "./persistence.js";

export type AvailableChain = Readonly<{
  definition: ChainDefinition;
  source: "builtin" | "custom";
}>;

const cloneCustomChain = (record: CustomChainRecord): CustomChainRecord => structuredClone(record);

/** Owns builtin and custom chain definitions available to the current core instance. */
export class ChainDefinitions {
  readonly #builtin = new Map<ChainRef, ChainDefinition>();
  readonly #custom = new Map<ChainRef, CustomChainRecord>();

  constructor(params: {
    builtinSeeds: readonly ChainDefinitionSeed[];
    customChains: readonly CustomChainRecord[];
  }) {
    for (const seed of params.builtinSeeds) {
      const chainRef = seed.definition.chainRef;
      if (this.#builtin.has(chainRef)) throw new DuplicateBuiltinChainDefinitionError(chainRef);
      this.#builtin.set(chainRef, cloneChainDefinition(seed.definition));
    }
    for (const record of params.customChains) {
      const chainRef = record.definition.chainRef;
      if (this.#builtin.has(chainRef)) throw new ChainDefinitionConflictError(chainRef);
      this.#custom.set(chainRef, cloneCustomChain(record));
    }
  }

  get(chainRef: ChainRef): AvailableChain | null {
    const builtin = this.#builtin.get(chainRef);
    if (builtin) return { definition: cloneChainDefinition(builtin), source: "builtin" };
    const custom = this.#custom.get(chainRef);
    return custom ? { definition: cloneChainDefinition(custom.definition), source: "custom" } : null;
  }

  list(): AvailableChain[] {
    const builtin = [...this.#builtin.values()]
      .map((definition) => ({
        definition: cloneChainDefinition(definition),
        source: "builtin" as const,
      }))
      .sort((left, right) => left.definition.chainRef.localeCompare(right.definition.chainRef));
    const custom = [...this.#custom.values()]
      .map((record) => ({
        definition: cloneChainDefinition(record.definition),
        source: "custom" as const,
      }))
      .sort((left, right) => left.definition.chainRef.localeCompare(right.definition.chainRef));
    return [...builtin, ...custom];
  }

  getCustom(chainRef: ChainRef): CustomChainRecord | null {
    const record = this.#custom.get(chainRef);
    return record ? cloneCustomChain(record) : null;
  }

  isBuiltin(chainRef: ChainRef): boolean {
    return this.#builtin.has(chainRef);
  }

  replaceCustom(record: CustomChainRecord): void {
    this.#custom.set(record.definition.chainRef, cloneCustomChain(record));
  }

  removeCustom(chainRef: ChainRef): void {
    this.#custom.delete(chainRef);
  }
}
