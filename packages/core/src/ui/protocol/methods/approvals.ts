import { z } from "zod";
import { ApprovalResolveRequestSchema, ApprovalResolveResponseSchema } from "../../../approvals/resolve.js";
import { defineMethod } from "./types.js";

const ApprovalPopupOpenResultSchema = z.strictObject({
  activationPath: z.enum(["focus", "create", "debounced"]),
  windowId: z.number().int().optional(),
});

export const approvalsMethods = {
  "ui.approvals.openPopup": defineMethod("command", z.undefined(), ApprovalPopupOpenResultSchema),
  "ui.approvals.resolve": defineMethod("command", ApprovalResolveRequestSchema, ApprovalResolveResponseSchema, {
    broadcastSnapshot: true,
  }),
} as const;
