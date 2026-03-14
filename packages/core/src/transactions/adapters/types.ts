import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { TransactionIssue, TransactionReceipt, TransactionRequest, TransactionWarning } from "../types.js";

export type PreparedTransactionResult<TPrepared = Record<string, unknown>> = {
  prepared: TPrepared;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
};

export type SignedTransactionPayload = {
  raw: string;
  hash: string | null;
};

export type TransactionPrepareContext = {
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest;
};

export type TransactionSignContext = Omit<TransactionPrepareContext, "from"> & { from: AccountAddress };

export type ReceiptResolution =
  | { status: "success"; receipt: TransactionReceipt }
  | { status: "failed"; receipt: TransactionReceipt };

export type ReplacementResolution = {
  hash: string | null;
  status: "replaced";
};
export type TransactionAdapter = {
  normalizeRequest?(request: TransactionRequest, chainRef: ChainRef): TransactionRequest;
  prepareTransaction(context: TransactionPrepareContext): Promise<PreparedTransactionResult>;
  signTransaction(
    context: TransactionSignContext,
    prepared: PreparedTransactionResult["prepared"],
  ): Promise<SignedTransactionPayload>;
  broadcastTransaction(context: TransactionPrepareContext, signed: SignedTransactionPayload): Promise<{ hash: string }>;
  fetchReceipt?(context: TransactionPrepareContext, hash: string): Promise<ReceiptResolution | null>;
  detectReplacement?(context: TransactionPrepareContext): Promise<ReplacementResolution | null>;
};
