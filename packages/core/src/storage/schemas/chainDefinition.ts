import { z } from "zod";
import { chainMetadataSchema } from "../../chains/metadata.js";
import { chainRefSchema, epochMillisecondsSchema } from "../validators.js";

export const ChainDefinitionSourceSchema = z.enum(["builtin", "custom"]);
export type ChainDefinitionSource = z.infer<typeof ChainDefinitionSourceSchema>;

const chainDefinitionEntitySchema = z
  .strictObject({
    chainRef: chainRefSchema,
    namespace: z.string().min(1),
    metadata: chainMetadataSchema,
    schemaVersion: z.number().int().positive(),
    updatedAt: epochMillisecondsSchema,
    source: ChainDefinitionSourceSchema,
    createdByOrigin: z.string().min(1).optional(),
  })
  .refine((value) => value.metadata.chainRef === value.chainRef, {
    error: "metadata.chainRef must match the entity chainRef",
    path: ["metadata", "chainRef"],
  })
  .refine((value) => value.metadata.namespace === value.namespace, {
    error: "metadata.namespace must match the entity namespace",
    path: ["metadata", "namespace"],
  })
  .refine((value) => value.source === "custom" || value.createdByOrigin === undefined, {
    error: "createdByOrigin is only allowed for custom chains",
    path: ["createdByOrigin"],
  });

export const CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION = 2;
export const ChainDefinitionEntitySchema = chainDefinitionEntitySchema;
export type ChainDefinitionEntity = z.infer<typeof ChainDefinitionEntitySchema>;
