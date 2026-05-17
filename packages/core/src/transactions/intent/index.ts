import type { TransactionRequest } from "../types.js";

/** Entry surface for transaction creation. */
export type TransactionIntentSource = "provider" | "wallet_ui" | "internal";

/** Request-surface metadata carried into transaction creation. */
export type TransactionIntentContext = {
  origin: string;
  transport: "provider" | "ui";
  sessionId?: string;
  requestId?: string;
  portId?: string;
};

export type TransactionIntentAccount = {
  accountKey: string;
  accountAddress: string;
  /** Address explicitly requested by the caller, if any. */
  requestedAddress?: string;
};

/** Unified transaction creation input. */
export type TransactionIntent = {
  source: TransactionIntentSource;
  namespace: string;
  chainRef: string;
  context: TransactionIntentContext;
  account: TransactionIntentAccount;
  request: TransactionRequest;
};
