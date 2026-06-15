import type { ChainDefinitionEntity } from "../../../storage/index.js";
import type { ChainRef } from "../../ids.js";
import type { ChainDefinition } from "../../metadata.js";
import type { ChainDefinitionsService, ChainDefinitionsUpdate } from "../chainDefinitions/types.js";
import { cloneSupportedChainEntity, cloneSupportedChainsState, toSupportedChainEntity } from "./state.js";
import type {
  AddSupportedChainOptions,
  AddSupportedChainResult,
  SupportedChainEntity,
  SupportedChainsService,
  SupportedChainsState,
  SupportedChainsUpdate,
} from "./types.js";

type SupportedChainsServiceOptions = {
  chainDefinitions: ChainDefinitionsService;
};

const toSupportedChain = (entity: ChainDefinitionEntity): SupportedChainEntity =>
  toSupportedChainEntity({
    definition: entity.definition,
    namespace: entity.namespace,
    source: entity.source,
    ...(entity.createdByOrigin ? { createdByOrigin: entity.createdByOrigin } : {}),
  });

const toSupportedChainsUpdate = (update: ChainDefinitionsUpdate): SupportedChainsUpdate => {
  if (update.kind === "removed") {
    return {
      kind: "removed",
      chainRef: update.chainRef,
      ...(update.previous ? { previous: toSupportedChain(update.previous) } : {}),
    };
  }

  if (update.kind === "added") {
    return {
      kind: "added",
      chain: toSupportedChain(update.chain),
    };
  }

  return {
    kind: "updated",
    chain: toSupportedChain(update.chain),
    previous: toSupportedChain(update.previous),
  };
};

export class InMemorySupportedChainsService implements SupportedChainsService {
  readonly #chainDefinitions: ChainDefinitionsService;

  constructor({ chainDefinitions }: SupportedChainsServiceOptions) {
    this.#chainDefinitions = chainDefinitions;
  }

  getState(): SupportedChainsState {
    return cloneSupportedChainsState(this.#chainDefinitions.getChains().map(toSupportedChain));
  }

  getChain(chainRef: ChainRef): SupportedChainEntity | null {
    const entry = this.#chainDefinitions.getChain(chainRef);
    return entry ? toSupportedChain(entry) : null;
  }

  listChains(): SupportedChainEntity[] {
    return this.getState().chains;
  }

  async addChain(chain: ChainDefinition, options?: AddSupportedChainOptions): Promise<AddSupportedChainResult> {
    const result = await this.#chainDefinitions.upsertCustomChain(chain, options);
    if (result.kind === "noop") {
      return {
        kind: "noop",
        chain: cloneSupportedChainEntity(toSupportedChain(result.chain)),
      };
    }

    if (result.kind === "added") {
      return {
        kind: "added",
        chain: cloneSupportedChainEntity(toSupportedChain(result.chain)),
      };
    }

    return {
      kind: "updated",
      chain: cloneSupportedChainEntity(toSupportedChain(result.chain)),
      previous: cloneSupportedChainEntity(toSupportedChain(result.previous)),
    };
  }

  async removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: SupportedChainEntity }> {
    const result = await this.#chainDefinitions.removeCustomChain(chainRef);
    return {
      removed: result.removed,
      ...(result.previous ? { previous: cloneSupportedChainEntity(toSupportedChain(result.previous)) } : {}),
    };
  }

  onStateChanged(handler: (state: SupportedChainsState) => void): () => void {
    return this.#chainDefinitions.onStateChanged((state) => {
      handler(cloneSupportedChainsState(state.chains.map(toSupportedChain)));
    });
  }

  onChainUpdated(handler: (update: SupportedChainsUpdate) => void): () => void {
    return this.#chainDefinitions.onChainUpdated((update) => {
      handler(toSupportedChainsUpdate(update));
    });
  }

  whenReady(): Promise<void> {
    return this.#chainDefinitions.whenReady();
  }
}
