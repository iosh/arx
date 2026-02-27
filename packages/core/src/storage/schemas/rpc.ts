import { z } from "zod";
import { epochMillisecondsSchema, httpUrlSchema, nonEmptyStringSchema } from "../validators.js";

export const RpcEndpointInfoSchema = z.strictObject({
  index: z.number().int().min(0),
  url: httpUrlSchema,
  type: z.enum(["public", "authenticated", "private"]).optional(),
  weight: z.number().positive().optional(),
  headers: z.record(nonEmptyStringSchema, z.string()).optional(),
});

export const RpcErrorSnapshotSchema = z.strictObject({
  message: nonEmptyStringSchema,
  code: z.union([z.number(), z.string()]).optional(),
  data: z.unknown().optional(),
  capturedAt: epochMillisecondsSchema,
});

export const RpcEndpointHealthSchema = z.strictObject({
  index: z.number().int().min(0),
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
  consecutiveFailures: z.number().int().min(0),
  lastError: RpcErrorSnapshotSchema.optional(),
  lastFailureAt: epochMillisecondsSchema.optional(),
  cooldownUntil: epochMillisecondsSchema.optional(),
});

export const RpcStrategySchema = z.strictObject({
  id: nonEmptyStringSchema,
  options: z.record(z.string(), z.unknown()).optional(),
});

export const RpcEndpointStateSchema = z
  .strictObject({
    activeIndex: z.number().int().min(0),
    endpoints: z.array(RpcEndpointInfoSchema).min(1),
    health: z.array(RpcEndpointHealthSchema),
    strategy: RpcStrategySchema,
    lastUpdatedAt: epochMillisecondsSchema,
  })
  .refine((value) => value.health.length === value.endpoints.length, {
    error: "Health list must match endpoint list",
    path: ["health"],
  })
  .refine((value) => value.activeIndex < value.endpoints.length, {
    error: "activeIndex must reference a declared endpoint",
    path: ["activeIndex"],
  });
