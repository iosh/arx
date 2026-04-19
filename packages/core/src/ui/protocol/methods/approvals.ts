import { z } from "zod";
import {
  ApprovalDetailSchema,
  ApprovalListEntrySchema,
  ApprovalResolveRequestSchema,
  ApprovalResolveResultSchema,
} from "../models/approvals.js";
import { defineMethod } from "./types.js";

export const approvalsMethods = {
  "ui.approvals.listPending": defineMethod("query", z.undefined(), z.array(ApprovalListEntrySchema), {
    broadcastSnapshot: false,
  }),
  "ui.approvals.getDetail": defineMethod(
    "query",
    z.strictObject({
      approvalId: z.string().min(1),
    }),
    ApprovalDetailSchema.nullable(),
    { broadcastSnapshot: false },
  ),
  "ui.approvals.resolve": defineMethod("command", ApprovalResolveRequestSchema, ApprovalResolveResultSchema, {
    broadcastSnapshot: false,
  }),
} as const;
