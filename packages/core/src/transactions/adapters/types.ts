import type { Caip2ChainId } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type {
  TransactionIssue,
  TransactionMeta,
  TransactionReceipt,
  TransactionRequest,
  TransactionWarning,
} from "../../controllers/transaction/types.js";

export type TransactionDraft = {
  prepared: Record<string, unknown>;
  summary: Record<string, unknown>;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
};

export type SignedTransactionPayload = {
  raw: string;
  hash: string | null;
};

export type TransactionAdapterContext = {
  namespace: string;
  chainRef: Caip2ChainId;
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
  buildDraft(context: TransactionAdapterContext): Promise<TransactionDraft>;
  signTransaction(context: TransactionAdapterContext, draft: TransactionDraft): Promise<SignedTransactionPayload>;
  broadcastTransaction(context: TransactionAdapterContext, signed: SignedTransactionPayload): Promise<{ hash: string }>;
  fetchReceipt?(context: TransactionAdapterContext, hash: string): Promise<ReceiptResolution | null>;
  detectReplacement?(context: TransactionAdapterContext): Promise<ReplacementResolution | null>;
};
