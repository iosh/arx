import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type {
  TransactionIssue,
  TransactionMeta,
  TransactionReceipt,
  TransactionRequest,
  TransactionWarning,
} from "../../controllers/transaction/types.js";

export type PreparedTransactionResult<TPrepared = Record<string, unknown>> = {
  prepared: TPrepared;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
};

export type SignedTransactionPayload = {
  raw: string;
  hash: string | null;
};

export type TransactionAdapterContext = {
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest;
  meta: TransactionMeta;
};

export type ReceiptResolution =
  | { status: "success"; receipt: TransactionReceipt }
  | { status: "failed"; receipt: TransactionReceipt };

export type ReplacementResolution = {
  hash: string | null;
  status: "replaced";
};
export type TransactionAdapter = {
  prepareTransaction(context: TransactionAdapterContext): Promise<PreparedTransactionResult>;
  signTransaction(
    context: TransactionAdapterContext,
    prepared: PreparedTransactionResult["prepared"],
  ): Promise<SignedTransactionPayload>;
  broadcastTransaction(context: TransactionAdapterContext, signed: SignedTransactionPayload): Promise<{ hash: string }>;
  fetchReceipt?(context: TransactionAdapterContext, hash: string): Promise<ReceiptResolution | null>;
  detectReplacement?(context: TransactionAdapterContext): Promise<ReplacementResolution | null>;
};
