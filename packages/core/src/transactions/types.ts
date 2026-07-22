import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../networks/chainRef.js";
import type * as Eip155 from "./eip155/types.js";

export type TransactionId = string;

export type TransactionInitiator = Readonly<{ type: "wallet" }> | Readonly<{ type: "dapp"; origin: string }>;

export type Transaction = Eip155.Transaction;

export type TransactionStatus = Transaction["state"]["status"];

export type TransactionCursor = Readonly<{
  createdAt: number;
  transactionId: TransactionId;
}>;

export type TransactionQuery = Readonly<{
  accountId?: AccountId;
  chainRef?: ChainRef;
  statuses?: readonly TransactionStatus[];
  cursor?: TransactionCursor;
  limit: number;
}>;

export type TransactionPage = Readonly<{
  transactions: readonly Transaction[];
  nextCursor?: TransactionCursor;
}>;
