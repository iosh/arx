import { z } from "zod";
import { chainMetadataSchema } from "../../chains/metadata.js";
import { chainRefSchema, epochMillisecondsSchema } from "../validators.js";

const chainDefinitionEntitySchema = z
  .strictObject({
    chainRef: chainRefSchema,
    namespace: z.string().min(1),
    metadata: chainMetadataSchema,
    schemaVersion: z.number().int().positive(),
    updatedAt: epochMillisecondsSchema,
  })
  .refine((value) => value.metadata.chainRef === value.chainRef, {
    error: "metadata.chainRef must match the entity chainRef",
    path: ["metadata", "chainRef"],
  })
  .refine((value) => value.metadata.namespace === value.namespace, {
    error: "metadata.namespace must match the entity namespace",
    path: ["metadata", "namespace"],
  });

export const CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION = 1;
export const ChainDefinitionEntitySchema = chainDefinitionEntitySchema;
export type ChainDefinitionEntity = z.infer<typeof ChainDefinitionEntitySchema>;
