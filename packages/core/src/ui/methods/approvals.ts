import { z } from "zod";
import { defineMethod } from "./types.js";

const PermissionRequestDescriptorSchema = z.strictObject({
  capability: z.string().min(1),
  scope: z.string().min(1),
  chains: z.array(z.string().min(1)),
});

const PermissionApprovalResultSchema = z.strictObject({
  granted: z.array(PermissionRequestDescriptorSchema),
});

const TransactionWarningSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
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
  caip2: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});

const TransactionMetaSchema = z.strictObject({
  id: z.string().min(1),
  namespace: z.string().min(1),
  caip2: z.string().min(1),
  origin: z.string().min(1),
  from: z.string().min(1).nullable(),
  request: TransactionRequestSchema,
  status: z.enum(["pending", "approved", "signed", "broadcast", "confirmed", "failed", "replaced"]),
  hash: z.string().nullable(),
  receipt: z.record(z.string(), z.unknown()).nullable(),
  error: TransactionErrorSchema.nullable(),
  userRejected: z.boolean(),
  warnings: z.array(TransactionWarningSchema),
  issues: z.array(TransactionWarningSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const ApprovalApproveResultSchema = z.strictObject({
  id: z.string().min(1),
  result: z.union([
    TransactionMetaSchema,
    z.array(z.string().min(1)),
    z.string().min(1),
    PermissionApprovalResultSchema,
    z.null(),
  ]),
});

const ApprovalRejectResultSchema = z.strictObject({
  id: z.string().min(1),
});

export const approvalsMethods = {
  "ui.approvals.approve": defineMethod(z.strictObject({ id: z.string().min(1) }), ApprovalApproveResultSchema, {
    broadcastSnapshot: true,
  }),

  "ui.approvals.reject": defineMethod(
    z.strictObject({ id: z.string().min(1), reason: z.string().min(1).optional() }),
    ApprovalRejectResultSchema,
    { broadcastSnapshot: true },
  ),
} as const;
