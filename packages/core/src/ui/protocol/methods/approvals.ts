import { ApprovalResolveRequestSchema, ApprovalResolveResponseSchema } from "../../../approvals/resolve.js";
import { defineMethod } from "./types.js";

export const approvalsMethods = {
  "ui.approvals.resolve": defineMethod(ApprovalResolveRequestSchema, ApprovalResolveResponseSchema, {
    broadcastSnapshot: true,
  }),
} as const;
