import { z } from "zod";

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

export type Eip155TransactionReview = z.infer<typeof Eip155TransactionReviewSchema>;
export type NamespaceTransactionReview = z.infer<typeof NamespaceTransactionReviewSchema>;
