import { z } from "zod";

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
