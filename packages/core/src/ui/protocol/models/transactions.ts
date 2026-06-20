import { z } from "zod";
import { type ChainRef, ChainRefSchema } from "../../../chains/ids.js";
import { type AccountKey, AccountKeySchema } from "../../../storage/records.js";
import type {
  JsonValue,
  TransactionReplacementType,
  TransactionSource,
  TransactionStatus,
  TransactionTerminalReason,
} from "../../../transactions/aggregate/index.js";

const TransactionStatusSchema = z.enum([
  "cancelled",
  "expired",
  "submitting",
  "submitted",
  "confirmed",
  "failed",
  "replaced",
  "dropped",
]);

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

export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;

export type UiTransaction = {
  id: string;
  status: TransactionStatus;
  namespace: string;
  chainRef: ChainRef;
  source: TransactionSource;
  origin: string;
  account: {
    accountKey: AccountKey;
    address: string;
  };
  submitted: JsonValue | null;
  receipt: JsonValue | null;
  replacement: {
    replaces: {
      transactionId: string;
      type: TransactionReplacementType;
    } | null;
    replacedBy: {
      transactionId: string;
    } | null;
  } | null;
  terminalReason: TransactionTerminalReason | null;
  createdAt: number;
  updatedAt: number;
};
