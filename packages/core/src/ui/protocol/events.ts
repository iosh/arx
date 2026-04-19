import { z } from "zod";
import { UiEntryLaunchContextSchema } from "./methods/entry.js";
import { UiSnapshotSchema } from "./schemas.js";

export const UI_EVENT_SNAPSHOT_CHANGED = "ui:snapshotChanged" as const;
export const UI_EVENT_ENTRY_CHANGED = "ui:entryChanged" as const;
export const UI_EVENT_APPROVALS_CHANGED = "ui:approvalsChanged" as const;
export const UI_EVENT_APPROVAL_DETAIL_CHANGED = "ui:approvalDetailChanged" as const;

export type UiEventDefinition = {
  payloadSchema: z.ZodTypeAny;
};

const defineEvent = <P extends z.ZodTypeAny>(payloadSchema: P) => ({ payloadSchema });

export const uiEvents = {
  [UI_EVENT_SNAPSHOT_CHANGED]: defineEvent(UiSnapshotSchema.strict()),
  [UI_EVENT_ENTRY_CHANGED]: defineEvent(UiEntryLaunchContextSchema),
  [UI_EVENT_APPROVALS_CHANGED]: defineEvent(
    z
      .object({
        reason: z.literal("changed"),
      })
      .strict(),
  ),
  [UI_EVENT_APPROVAL_DETAIL_CHANGED]: defineEvent(
    z
      .object({
        approvalId: z.string().min(1),
      })
      .strict(),
  ),
} as const satisfies Record<string, UiEventDefinition>;
