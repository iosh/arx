import { z } from "zod";
import { ChainRefSchema } from "../chains/ids.js";
import type { ApprovalAccountSelectionDecision } from "../controllers/approval/types.js";
import {
  ConnectionGrantKinds,
  type ConnectionGrantRequest,
  type RequestPermissionsApprovalResult,
} from "../controllers/permission/types.js";
import { AccountKeySchema } from "../storage/records.js";

export const ConnectionGrantRequestSchema = z.strictObject({
  grantKind: z.literal(ConnectionGrantKinds.Accounts),
  chainRefs: z.tuple([ChainRefSchema]).rest(ChainRefSchema),
}) satisfies z.ZodType<ConnectionGrantRequest>;

export const RequestPermissionsApprovalResultSchema = z.strictObject({
  grantedGrants: z.array(ConnectionGrantRequestSchema),
}) satisfies z.ZodType<RequestPermissionsApprovalResult>;

export const ApprovalAccountSelectionDecisionSchema = z
  .strictObject({
    accountKeys: z.tuple([AccountKeySchema]).rest(AccountKeySchema),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.accountKeys).size !== value.accountKeys.length) {
      ctx.addIssue({
        code: "custom",
        message: "decision.accountKeys must not contain duplicates",
        path: ["accountKeys"],
      });
    }
  }) satisfies z.ZodType<ApprovalAccountSelectionDecision>;

export const TransactionDiagnosticSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]).optional(),
  data: z.unknown().optional(),
});

export const TransactionWarningSchema = TransactionDiagnosticSchema.extend({
  kind: z.literal("warning"),
});

export const TransactionIssueSchema = TransactionDiagnosticSchema.extend({
  kind: z.literal("issue"),
});

export const TransactionErrorSchema = z.strictObject({
  name: z.string().min(1),
  message: z.string().min(1),
  code: z.number().optional(),
  data: z.unknown().optional(),
});

export const TransactionRequestSchema = z.strictObject({
  namespace: z.string().min(1),
  chainRef: ChainRefSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const TransactionMetaSchema = z.strictObject({
  id: z.string().min(1),
  namespace: z.string().min(1),
  chainRef: ChainRefSchema,
  origin: z.string().min(1),
  from: z.string().min(1).nullable(),
  request: TransactionRequestSchema,
  prepared: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(["pending", "approved", "signed", "broadcast", "confirmed", "failed", "replaced"]),
  hash: z.string().nullable(),
  receipt: z.record(z.string(), z.unknown()).nullable(),
  error: TransactionErrorSchema.nullable(),
  userRejected: z.boolean(),
  warnings: z.array(TransactionWarningSchema),
  issues: z.array(TransactionIssueSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const ApprovalResolvedValueSchema = z.union([
  TransactionMetaSchema,
  z.array(z.string().min(1)),
  z.string().min(1),
  RequestPermissionsApprovalResultSchema,
  z.null(),
]);

export const ApprovalResolveRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    id: z.string().min(1),
    action: z.literal("approve"),
    decision: ApprovalAccountSelectionDecisionSchema.optional(),
  }),
  z.strictObject({
    id: z.string().min(1),
    action: z.literal("reject"),
    reason: z.string().min(1).optional(),
  }),
]);

export const ApprovalResolveResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    id: z.string().min(1),
    status: z.literal("approved"),
    terminalReason: z.literal("user_approve"),
    value: ApprovalResolvedValueSchema,
  }),
  z.strictObject({
    id: z.string().min(1),
    status: z.literal("rejected"),
    terminalReason: z.literal("user_reject"),
  }),
]);

export type ApprovalResolvedValue = z.infer<typeof ApprovalResolvedValueSchema>;
