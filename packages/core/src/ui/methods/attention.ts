import { z } from "zod";
import { defineMethod } from "./types.js";

const OpenNotificationResultSchema = z.strictObject({
  activationPath: z.enum(["focus", "create", "debounced"]),
  windowId: z.number().int().optional(),
});

export const attentionMethods = {
  "ui.attention.openNotification": defineMethod(z.undefined(), OpenNotificationResultSchema),
} as const;
