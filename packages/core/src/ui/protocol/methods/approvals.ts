import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { defineMethod } from "./types.js";

const PermissionRequestDescriptorSchema = z.strictObject({
  capability: z.string().min(1),
  chainRefs: z.array(ChainRefSchema),
});

const PermissionApprovalResultSchema = z.strictObject({
  granted: z.array(PermissionRequestDescriptorSchema),
});

const TransactionDiagnosticSchema = z.strictObject({
  kind: z.enum(["warning", "issue"]).optional(),
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]).optional(),
  data: z.unknown().optional(),
});

const TransactionErrorSchema = z.strictObject({
  name: z.string().min(1),
  message: z.string().min(1),
  code: z.number().optional(),
  data: z.unknown().optional(),
});

const TransactionRequestSchema = z.strictObject({
  namespace: z.string().min(1),
  chainRef: ChainRefSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
});

const TransactionMetaSchema = z.strictObject({
  id: z.string().min(1),
  namespace: z.string().min(1),
  chainRef: ChainRefSchema,
  origin: z.string().min(1),
  from: z.string().min(1).nullable(),
  request: TransactionRequestSchema,
  status: z.enum(["pending", "approved", "signed", "broadcast", "confirmed", "failed", "replaced"]),
  hash: z.string().nullable(),
  receipt: z.record(z.string(), z.unknown()).nullable(),
  error: TransactionErrorSchema.nullable(),
  userRejected: z.boolean(),
  warnings: z.array(TransactionDiagnosticSchema),
  issues: z.array(TransactionDiagnosticSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const ApprovalResultValueSchema = z.union([
  TransactionMetaSchema,
  z.array(z.string().min(1)),
  z.string().min(1),
  PermissionApprovalResultSchema,
  z.null(),
]);

const ApprovalResolveParamsSchema = z.discriminatedUnion("action", [
  z.strictObject({
    id: z.string().min(1),
    action: z.literal("approve"),
    decision: z.unknown().optional(),
  }),
  z.strictObject({
    id: z.string().min(1),
    action: z.literal("reject"),
    reason: z.string().min(1).optional(),
  }),
]);

const ApprovalResolveResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    id: z.string().min(1),
    status: z.literal("approved"),
    result: ApprovalResultValueSchema,
  }),
  z.strictObject({
    id: z.string().min(1),
    status: z.literal("rejected"),
  }),
]);

export const approvalsMethods = {
  "ui.approvals.resolve": defineMethod(ApprovalResolveParamsSchema, ApprovalResolveResultSchema, {
    broadcastSnapshot: true,
  }),
} as const;
