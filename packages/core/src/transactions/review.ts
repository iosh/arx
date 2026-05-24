import { z } from "zod";

export const Eip155TransactionReviewDetailsSchema = z.strictObject({
  namespace: z.literal("eip155"),
  kind: z.enum(["native_transfer", "contract_interaction", "contract_deployment"]),
  from: z.string().min(1),
  to: z.string().nullable(),
  value: z.string().min(1),
  data: z.string().nullable(),
  gasLimit: z.string().nullable(),
  fees: z.strictObject({
    gasPrice: z.string().nullable(),
    maxFeePerGas: z.string().nullable(),
    maxPriorityFeePerGas: z.string().nullable(),
  }),
});

export const TransactionReviewDetailsSchema = Eip155TransactionReviewDetailsSchema;

export type Eip155TransactionReviewDetails = z.infer<typeof Eip155TransactionReviewDetailsSchema>;
export type TransactionReviewDetails = z.infer<typeof TransactionReviewDetailsSchema>;
