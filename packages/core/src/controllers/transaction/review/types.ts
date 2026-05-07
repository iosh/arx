import { z } from "zod";
import type { NamespaceTransactionReview } from "../../../transactions/review.js";
import { NamespaceTransactionReviewSchema } from "../../../transactions/review.js";

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
export type TransactionReviewPrepare = z.infer<typeof TransactionReviewPrepareSchema>;
export type SendTransactionApprovalReview = {
  updatedAt: number;
  namespaceReview: NamespaceTransactionReview | null;
  prepare: TransactionReviewPrepare;
};
