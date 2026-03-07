import type { ChainRef } from "../../chains/ids.js";
import {
  type ChainMetadata,
  cloneChainMetadata,
  isSameChainMetadata,
  normalizeChainMetadata,
  validateChainMetadata,
} from "../../chains/metadata.js";
import { type ChainDefinitionEntity, ChainDefinitionEntitySchema } from "../../storage/index.js";
import type { ChainDefinitionsState } from "./types.js";

export const isSameChainDefinitionEntity = (previous: ChainDefinitionEntity, next: ChainDefinitionEntity) => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.namespace !== next.namespace ||
    previous.schemaVersion !== next.schemaVersion ||
    previous.updatedAt !== next.updatedAt
  ) {
    return false;
  }

  return isSameChainMetadata(previous.metadata, next.metadata);
};

export const cloneChainDefinitionEntity = (entity: ChainDefinitionEntity): ChainDefinitionEntity => ({
  chainRef: entity.chainRef,
  namespace: entity.namespace,
  metadata: cloneChainMetadata(entity.metadata),
  schemaVersion: entity.schemaVersion,
  updatedAt: entity.updatedAt,
});

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

export const normalizeAndValidateMetadata = (metadata: ChainMetadata) => {
  const validated = validateChainMetadata(metadata);
  return normalizeChainMetadata(validated);
};

export const parseEntity = (params: {
  chainRef: ChainRef;
  namespace: string;
  metadata: ChainMetadata;
  schemaVersion: number;
  updatedAt: number;
}): ChainDefinitionEntity => {
  return ChainDefinitionEntitySchema.parse({
    chainRef: params.chainRef,
    namespace: params.namespace,
    metadata: params.metadata,
    schemaVersion: params.schemaVersion,
    updatedAt: params.updatedAt,
  });
};
