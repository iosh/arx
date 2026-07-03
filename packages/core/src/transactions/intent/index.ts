import type { TransactionRequest } from "../types.js";

export type TransactionIntentAccount = {
  accountId: string;
  accountAddress: string;
  /** Address explicitly requested by the caller, if any. */
  requestedAddress?: string;
};

/** Unified transaction creation input. */
export type TransactionIntent = {
  namespace: string;
  chainRef: string;
  account: TransactionIntentAccount;
  request: TransactionRequest;
};
