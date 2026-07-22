import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../networks/chainRef.js";
import type * as Eip155 from "./eip155/types.js";
import type { TransactionId, TransactionInitiator } from "./types.js";

export type Eip155PrepareTransactionInput = Readonly<{
  namespace: "eip155";
  chainRef: ChainRef;
  accountId: AccountId;
  initiator: TransactionInitiator;
  transaction: Eip155.TransactionRequest;
}>;

export type PrepareTransactionInput = Eip155PrepareTransactionInput;

export type WalletPrepareTransactionInput = Omit<Eip155PrepareTransactionInput, "initiator">;

export type Eip155PreparedTransaction = Readonly<{
  namespace: "eip155";
  chainRef: ChainRef;
  accountId: AccountId;
  initiator: TransactionInitiator;
  replacesTransactionId?: TransactionId;
  transaction: Eip155.PreparedTransaction;
}>;

export type PreparedTransaction = Eip155PreparedTransaction;
