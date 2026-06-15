import type { ChainRef } from "../../chains/ids.js";
import type { ChainDefinition } from "../../chains/metadata.js";

export const CHAIN_DEFINITION_SOURCES = ["builtin", "custom"] as const;
export type ChainDefinitionSource = (typeof CHAIN_DEFINITION_SOURCES)[number];

export const CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION = 2;

export type ChainDefinitionEntity = {
  chainRef: ChainRef;
  namespace: string;
  definition: ChainDefinition;
  schemaVersion: typeof CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION;
  updatedAt: number;
  source: ChainDefinitionSource;
  createdByOrigin?: string | undefined;
};
