import { z } from "zod";
import { ChainRefSchema } from "../../chains/ids.js";
import { AccountKeySchema } from "../../storage/records.js";
import { TRANSACTION_STATUSES } from "../../transactions/aggregate/index.js";

const TransactionStatusSchema = z.enum(TRANSACTION_STATUSES);

const WalletApiListTransactionsSchema = z
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

const WalletApiTransactionDetailSchema = z.strictObject({
  transactionId: z.string().min(1),
});

export const WalletApiEip155TransactionDraftChangeSchema = z.strictObject({
  field: z.enum(["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]),
  value: z.string().min(1).nullable(),
});

export const WalletApiWalletTransactionRequestSchema = z.strictObject({
  namespace: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const WalletApiNamespaceTransactionDraftEditSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("eip155"),
    changes: z.array(WalletApiEip155TransactionDraftChangeSchema),
  }),
]);

export const WalletApiTransactionsSchemas = {
  listHistory: WalletApiListTransactionsSchema,
  getDetail: WalletApiTransactionDetailSchema,
  requestSendTransactionApproval: z.strictObject({
    request: WalletApiWalletTransactionRequestSchema,
  }),
  rerunPrepare: z.strictObject({
    approvalId: z.string().min(1),
  }),
  applyDraftEdit: z.strictObject({
    approvalId: z.string().min(1),
    edit: WalletApiNamespaceTransactionDraftEditSchema,
    mode: z.string().min(1).optional(),
  }),
} satisfies Record<string, z.ZodTypeAny>;
