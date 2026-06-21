import { z } from "zod";
import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

const UiApprovalsListPendingParamsSchema = z.undefined();

export const approvalsMethods = {
  "ui.approvals.listPending": defineMethod("query", UiApprovalsListPendingParamsSchema),
  "ui.approvals.getDetail": defineMethod("query", WalletApiSchemas.approvals.getDetail),
  "ui.approvals.resolve": defineMethod("command", WalletApiSchemas.approvals.resolve),
} as const;
