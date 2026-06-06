import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { AccountKeySchema } from "../../../storage/records.js";
import { TRANSACTION_TERMINAL_REASON_KINDS } from "../../../transactions/aggregate/index.js";

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const TransactionStatusSchema = z.enum([
  "awaiting_approval",
  "rejected",
  "cancelled",
  "expired",
  "submitting",
  "submitted",
  "confirmed",
  "failed",
  "replaced",
  "dropped",
]);

const TransactionSourceSchema = z.enum(["dapp", "wallet"]);

const TransactionTerminalReasonSchema = z.strictObject({
  kind: z.enum(TRANSACTION_TERMINAL_REASON_KINDS),
  message: z.string().min(1),
  namespace: z.string().min(1).nullable(),
  code: z.string().min(1),
  details: JsonValueSchema.nullable(),
  retryable: z.boolean(),
});

export const ListTransactionsQuerySchema = z
  .strictObject({
    namespace: z.string().min(1).optional(),
    chainRef: ChainRefSchema.optional(),
    accountKey: AccountKeySchema.optional(),
    status: TransactionStatusSchema.optional(),
    limit: z.number().int().positive().optional(),
    before: z
      .strictObject({
        createdAt: z.number().int().min(0),
        id: z.string().min(1),
      })
      .optional(),
  })
  .optional();

export const TransactionSchema = z.strictObject({
  id: z.string().min(1),
  status: TransactionStatusSchema,
  namespace: z.string().min(1),
  chainRef: ChainRefSchema,
  source: TransactionSourceSchema,
  origin: z.string().min(1),
  account: z.strictObject({
    accountKey: AccountKeySchema,
    address: z.string().min(1),
  }),
  requestKind: z.string().min(1),
  submitted: JsonValueSchema.nullable(),
  receipt: JsonValueSchema.nullable(),
  replacement: z
    .strictObject({
      replaces: z
        .strictObject({
          transactionId: z.string().min(1),
          type: z.enum(["speed_up", "cancel"]),
        })
        .nullable(),
      replacedBy: z
        .strictObject({
          transactionId: z.string().min(1),
        })
        .nullable(),
    })
    .nullable(),
  terminalReason: TransactionTerminalReasonSchema.nullable(),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});

export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
export type UiTransaction = z.infer<typeof TransactionSchema>;
