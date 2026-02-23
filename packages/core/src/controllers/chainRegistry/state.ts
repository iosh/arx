import type { ChainRef } from "../../chains/ids.js";
import {
  type ChainMetadata,
  cloneChainMetadata,
  isSameChainMetadata,
  normalizeChainMetadata,
  validateChainMetadata,
} from "../../chains/metadata.js";
import { type ChainRegistryEntity, ChainRegistryEntitySchema } from "../../storage/index.js";
import type { ChainRegistryState } from "./types.js";

export const isSameChainRegistryEntity = (previous: ChainRegistryEntity, next: ChainRegistryEntity) => {
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

export const cloneChainRegistryEntity = (entity: ChainRegistryEntity): ChainRegistryEntity => ({
  chainRef: entity.chainRef,
  namespace: entity.namespace,
  metadata: cloneChainMetadata(entity.metadata),
  schemaVersion: entity.schemaVersion,
  updatedAt: entity.updatedAt,
});

export const cloneChainRegistryState = (entities: Iterable<ChainRegistryEntity>): ChainRegistryState => ({
  chains: Array.from(entities, cloneChainRegistryEntity).sort((a, b) => a.chainRef.localeCompare(b.chainRef)),
});

export const isSameChainRegistryState = (previous?: ChainRegistryState, next?: ChainRegistryState) => {
  if (!previous || !next) return false;
  if (previous.chains.length !== next.chains.length) return false;

  for (let i = 0; i < previous.chains.length; i += 1) {
    const prevChain = previous.chains[i];
    const nextChain = next.chains[i];
    if (!prevChain || !nextChain) return false;
    if (!isSameChainRegistryEntity(prevChain, nextChain)) return false;
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
}): ChainRegistryEntity => {
  return ChainRegistryEntitySchema.parse({
    chainRef: params.chainRef,
    namespace: params.namespace,
    metadata: params.metadata,
    schemaVersion: params.schemaVersion,
    updatedAt: params.updatedAt,
  });
};
