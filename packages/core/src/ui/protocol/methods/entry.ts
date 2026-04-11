import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { defineMethod } from "./types.js";

const UiEnvironmentSchema = z.enum(["popup", "notification", "onboarding"]);
const UiEntryReasonSchema = z.enum([
  "idle",
  "manual_open",
  "install",
  "onboarding_required",
  "approval_created",
  "unlock_required",
]);

const UiEntryContextSchema = z.strictObject({
  approvalId: z.string().min(1).nullable(),
  origin: z.string().min(1).nullable(),
  method: z.string().min(1).nullable(),
  chainRef: ChainRefSchema.nullable(),
  namespace: z.string().min(1).nullable(),
});

const UiEntryLaunchContextParamsSchema = z.strictObject({
  environment: UiEnvironmentSchema,
});

export const UiEntryLaunchContextSchema = z.strictObject({
  environment: UiEnvironmentSchema,
  reason: UiEntryReasonSchema,
  context: UiEntryContextSchema,
});

export const entryMethods = {
  "ui.entry.getLaunchContext": defineMethod("query", UiEntryLaunchContextParamsSchema, UiEntryLaunchContextSchema),
} as const;
