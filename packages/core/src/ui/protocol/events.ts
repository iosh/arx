import type { z } from "zod";
import { UiSnapshotSchema } from "./schemas.js";

export const UI_EVENT_SNAPSHOT_CHANGED = "ui:snapshotChanged" as const;

export type UiEventDefinition = {
  payloadSchema: z.ZodTypeAny;
};

const defineEvent = <P extends z.ZodTypeAny>(payloadSchema: P) => ({ payloadSchema });

export const uiEvents = {
  [UI_EVENT_SNAPSHOT_CHANGED]: defineEvent(UiSnapshotSchema.strict()),
} as const satisfies Record<string, UiEventDefinition>;
