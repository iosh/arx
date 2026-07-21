import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../networks/chainRef.js";
import type * as Eip155 from "./eip155/types.js";
import type { TransactionId } from "./persistence.js";

export type TransactionInitiator = Readonly<{ type: "wallet" }> | Readonly<{ type: "dapp"; origin: string }>;

export type Eip155PreparedTransaction = Readonly<{
  namespace: "eip155";
  chainRef: ChainRef;
  accountId: AccountId;
  initiator: TransactionInitiator;
  replacesTransactionId?: TransactionId;
  transaction: Eip155.PreparedTransaction;
}>;

export type PreparedTransaction = Eip155PreparedTransaction;
