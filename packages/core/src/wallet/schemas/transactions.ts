import { z } from "zod";
import { ChainRefSchema } from "../../chains/ids.js";

export const WalletApiEip155TransactionDraftChangeSchema = z.strictObject({
  field: z.enum(["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]),
  value: z.string().min(1).nullable(),
});

export const WalletApiNamespaceTransactionDraftEditSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("eip155"),
    changes: z.array(WalletApiEip155TransactionDraftChangeSchema),
  }),
]);

export const WalletApiTransactionsSchemas = {
  requestSendTransactionApproval: z.strictObject({
    to: z.string().min(1),
    valueEther: z.string().min(1),
    chainRef: ChainRefSchema.optional(),
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
