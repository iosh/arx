import { z } from "zod";
import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

const UiApprovalsListPendingParamsSchema = z.undefined();

const UiApprovalDetailParamsSchema = z.strictObject({
  approvalId: z.string().min(1),
});

export const approvalsMethods = {
  "ui.approvals.listPending": defineMethod("query", UiApprovalsListPendingParamsSchema, {
    broadcastSnapshot: false,
  }),
  "ui.approvals.getDetail": defineMethod("query", UiApprovalDetailParamsSchema, { broadcastSnapshot: false }),
  "ui.approvals.resolve": defineMethod("command", WalletApiSchemas.approvals.resolve, {
    broadcastSnapshot: false,
  }),
} as const;
