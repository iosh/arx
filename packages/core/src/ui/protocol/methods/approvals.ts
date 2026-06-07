import { z } from "zod";
import { ApprovalResolveRequestSchema } from "../models/approvals.js";
import { defineMethod } from "./types.js";

export const approvalsMethods = {
  "ui.approvals.listPending": defineMethod("query", z.undefined(), {
    broadcastSnapshot: false,
  }),
  "ui.approvals.getDetail": defineMethod(
    "query",
    z.strictObject({
      approvalId: z.string().min(1),
    }),
    { broadcastSnapshot: false },
  ),
  "ui.approvals.resolve": defineMethod("command", ApprovalResolveRequestSchema, {
    broadcastSnapshot: false,
  }),
} as const;
