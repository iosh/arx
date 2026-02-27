import type { ZodTypeAny } from "zod";
import { z } from "zod";
import { epochMillisecondsSchema } from "../validators.js";

export const createSnapshotSchema = <TPayload extends ZodTypeAny, const TVersion extends number>(config: {
  version: TVersion;
  payload: TPayload;
}) =>
  z.strictObject({
    version: z.literal(config.version),
    updatedAt: epochMillisecondsSchema,
    payload: config.payload,
  });
