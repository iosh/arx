import { z } from "zod";
import { nonEmptyStringSchema, originStringSchema } from "../storage/schemas.js";

export const RequestContextSchema = z.strictObject({
  transport: z.enum(["provider", "ui"]),
  portId: nonEmptyStringSchema,
  sessionId: z.string().uuid(),
  requestId: nonEmptyStringSchema,
  origin: originStringSchema,
});

export type RequestContext = z.infer<typeof RequestContextSchema>;
