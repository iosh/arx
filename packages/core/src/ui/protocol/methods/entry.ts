import { z } from "zod";
import type { ChainRef } from "../../../chains/ids.js";
import type { ApprovalDetail } from "../../../wallet/types.js";
import { defineMethod } from "./types.js";

const UI_ENVIRONMENTS = ["popup", "notification", "onboarding"] as const;
const UI_ENTRY_REASONS = [
  "idle",
  "manual_open",
  "install",
  "onboarding_required",
  "approval_created",
  "unlock_required",
] as const;

export type UiEnvironment = (typeof UI_ENVIRONMENTS)[number];
export type UiEntryReason = (typeof UI_ENTRY_REASONS)[number];

export type UiEntryContext = {
  approvalId: string | null;
  origin: string | null;
  method: string | null;
  chainRef: ChainRef | null;
  namespace: string | null;
};

export type UiEntryLaunchContext = {
  environment: UiEnvironment;
  reason: UiEntryReason;
  context: UiEntryContext;
};

export type UiEntryBootstrap = {
  entry: UiEntryLaunchContext;
  requestedApproval: {
    approvalId: string;
    initialDetail: ApprovalDetail;
  } | null;
};

const UiEnvironmentSchema = z.enum(UI_ENVIRONMENTS);

const UiEntryLaunchContextParamsSchema = z.strictObject({
  environment: UiEnvironmentSchema,
});

export const entryMethods = {
  "ui.entry.getLaunchContext": defineMethod("query", UiEntryLaunchContextParamsSchema),
  "ui.entry.getBootstrap": defineMethod("query", UiEntryLaunchContextParamsSchema),
} as const;
