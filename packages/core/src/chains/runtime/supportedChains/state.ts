import { type ChainDefinition, cloneChainDefinition, isSameChainDefinition } from "../../metadata.js";
import type { SupportedChainEntity, SupportedChainsState } from "./types.js";

export const cloneSupportedChainEntity = (entity: SupportedChainEntity): SupportedChainEntity => ({
  chainRef: entity.chainRef,
  namespace: entity.namespace,
  definition: cloneChainDefinition(entity.definition),
  source: entity.source,
  ...(entity.createdByOrigin ? { createdByOrigin: entity.createdByOrigin } : {}),
});

export const cloneSupportedChainsState = (entities: Iterable<SupportedChainEntity>): SupportedChainsState => ({
  chains: Array.from(entities, cloneSupportedChainEntity).sort((a, b) => a.chainRef.localeCompare(b.chainRef)),
});

export const isSameSupportedChainEntity = (previous: SupportedChainEntity, next: SupportedChainEntity): boolean => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.namespace !== next.namespace ||
    previous.source !== next.source ||
    previous.createdByOrigin !== next.createdByOrigin
  ) {
    return false;
  }

  return isSameChainDefinition(previous.definition, next.definition);
};

export const isSameSupportedChainsState = (previous?: SupportedChainsState, next?: SupportedChainsState): boolean => {
  if (!previous || !next) return false;
  if (previous.chains.length !== next.chains.length) return false;

  for (let index = 0; index < previous.chains.length; index += 1) {
    const prevChain = previous.chains[index];
    const nextChain = next.chains[index];
    if (!prevChain || !nextChain) return false;
    if (!isSameSupportedChainEntity(prevChain, nextChain)) return false;
  }

  return true;
};

export const toSupportedChainEntity = (params: {
  definition: ChainDefinition;
  namespace: string;
  source: SupportedChainEntity["source"];
  createdByOrigin?: string;
}): SupportedChainEntity => {
  return {
    chainRef: params.definition.chainRef,
    namespace: params.namespace,
    definition: cloneChainDefinition(params.definition),
    source: params.source,
    ...(params.createdByOrigin ? { createdByOrigin: params.createdByOrigin } : {}),
  };
};
