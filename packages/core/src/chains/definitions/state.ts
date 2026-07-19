import type { ChainRef } from "../../networks/chainRef.js";
import { cloneChainDefinition, isSameChainDefinition, validateChainDefinition } from "../../networks/definition.js";
import type { ChainDefinition } from "../../networks/types.js";
import type { ChainDefinitionEntity, ChainDefinitionsState } from "./types.js";

export const isSameChainDefinitionEntity = (previous: ChainDefinitionEntity, next: ChainDefinitionEntity) => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.namespace !== next.namespace ||
    previous.schemaVersion !== next.schemaVersion ||
    previous.updatedAt !== next.updatedAt ||
    previous.source !== next.source ||
    previous.createdByOrigin !== next.createdByOrigin
  ) {
    return false;
  }

  return isSameChainDefinition(previous.definition, next.definition);
};

export const cloneChainDefinitionEntity = (entity: ChainDefinitionEntity): ChainDefinitionEntity =>
  structuredClone(entity);

export const cloneChainDefinitionsState = (entities: Iterable<ChainDefinitionEntity>): ChainDefinitionsState => ({
  chains: Array.from(entities, cloneChainDefinitionEntity).sort((a, b) => a.chainRef.localeCompare(b.chainRef)),
});

export const isSameChainDefinitionsState = (previous?: ChainDefinitionsState, next?: ChainDefinitionsState) => {
  if (!previous || !next) return false;
  if (previous.chains.length !== next.chains.length) return false;

  for (let i = 0; i < previous.chains.length; i += 1) {
    const prevChain = previous.chains[i];
    const nextChain = next.chains[i];
    if (!prevChain || !nextChain) return false;
    if (!isSameChainDefinitionEntity(prevChain, nextChain)) return false;
  }

  return true;
};

export const prepareChainDefinitionForStorage = (definition: ChainDefinition) => {
  return cloneChainDefinition(validateChainDefinition(definition));
};

export const parseEntity = (params: {
  chainRef: ChainRef;
  namespace: string;
  definition: ChainDefinition;
  schemaVersion: number;
  updatedAt: number;
  source: ChainDefinitionEntity["source"];
  createdByOrigin?: string;
}): ChainDefinitionEntity => {
  return {
    chainRef: params.chainRef,
    namespace: params.namespace,
    definition: params.definition,
    schemaVersion: params.schemaVersion as ChainDefinitionEntity["schemaVersion"],
    updatedAt: params.updatedAt,
    source: params.source,
    ...(params.createdByOrigin ? { createdByOrigin: params.createdByOrigin } : {}),
  };
};
