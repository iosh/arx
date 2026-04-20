import { z } from "zod";

export const TransactionReviewMessageSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const TransactionReviewErrorSchema = z.strictObject({
  reason: z.string().min(1),
  message: z.string().min(1),
  data: z.unknown().optional(),
});

export const TransactionReviewStateSchema = z.strictObject({
  status: z.enum(["preparing", "ready", "failed"]),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int(),
  error: TransactionReviewErrorSchema.nullable(),
});

export const Eip155TransactionReviewSchema = z.strictObject({
  namespace: z.literal("eip155"),
  summary: z.strictObject({
    from: z.string().min(1),
    to: z.string().nullable(),
    value: z.string().optional(),
    data: z.string().optional(),
  }),
  execution: z.strictObject({
    gas: z.string().optional(),
    gasPrice: z.string().optional(),
    maxFeePerGas: z.string().optional(),
    maxPriorityFeePerGas: z.string().optional(),
  }),
});

export const NamespaceTransactionReviewSchema = z.discriminatedUnion("namespace", [Eip155TransactionReviewSchema]);

export const SendTransactionApprovalReviewSchema = z.strictObject({
  reviewState: TransactionReviewStateSchema,
  warnings: z.array(TransactionReviewMessageSchema),
  approvalBlocker: TransactionReviewMessageSchema.nullable(),
  namespaceReview: NamespaceTransactionReviewSchema.nullable(),
});

export type TransactionReviewMessage = z.infer<typeof TransactionReviewMessageSchema>;
export type TransactionReviewError = z.infer<typeof TransactionReviewErrorSchema>;
export type TransactionReviewState = z.infer<typeof TransactionReviewStateSchema>;
export type NamespaceTransactionReview = z.infer<typeof NamespaceTransactionReviewSchema>;
export type SendTransactionApprovalReview = z.infer<typeof SendTransactionApprovalReviewSchema>;

export type TransactionReviewRuntimeStatus = TransactionReviewState["status"] | "invalidated";

export type TransactionReviewSession = {
  transactionId: string;
  revision: number;
  status: TransactionReviewRuntimeStatus;
  updatedAt: number;
  error: TransactionReviewError | null;
  invalidatedBy?: string | undefined;
};
