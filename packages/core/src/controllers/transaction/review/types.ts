import { z } from "zod";
import type { TransactionPrepared } from "../../../transactions/types.js";

export const TransactionReviewErrorSchema = z.strictObject({
  reason: z.string().min(1),
  message: z.string().min(1),
  data: z.unknown().optional(),
});

// User-resolvable review stop: visible review, but approval is not allowed.
export const TransactionReviewBlockerSchema = z.strictObject({
  reason: z.string().min(1),
  message: z.string().min(1),
  data: z.unknown().optional(),
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

export const TransactionReviewPrepareSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("preparing"),
  }),
  z.strictObject({
    state: z.literal("ready"),
  }),
  z.strictObject({
    state: z.literal("blocked"),
    blocker: TransactionReviewBlockerSchema,
  }),
  z.strictObject({
    state: z.literal("failed"),
    error: TransactionReviewErrorSchema,
  }),
]);

export const SendTransactionApprovalReviewSchema = z.strictObject({
  updatedAt: z.number().int(),
  namespaceReview: NamespaceTransactionReviewSchema.nullable(),
  prepare: TransactionReviewPrepareSchema,
});

export type TransactionReviewBlocker = z.infer<typeof TransactionReviewBlockerSchema>;
export type TransactionReviewError = z.infer<typeof TransactionReviewErrorSchema>;
export type NamespaceTransactionReview = z.infer<typeof NamespaceTransactionReviewSchema>;
export type TransactionReviewPrepare = z.infer<typeof TransactionReviewPrepareSchema>;
export type SendTransactionApprovalReview = z.infer<typeof SendTransactionApprovalReviewSchema>;

export type TransactionReviewRuntimeStatus = TransactionReviewPrepare["state"] | "invalidated";

export type TransactionReviewSession = {
  transactionId: string;
  sessionToken: string;
  status: TransactionReviewRuntimeStatus;
  updatedAt: number;
  reviewPreparedSnapshot: TransactionPrepared | null;
  error: TransactionReviewError | null;
  blocker: TransactionReviewBlocker | null;
  invalidatedBy?: string | undefined;
};
