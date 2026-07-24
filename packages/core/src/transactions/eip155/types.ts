import type { Hex } from "ox/Hex";
import type { AccountId } from "../../accounts/accountId.js";
import type { JsonValue } from "../../errors.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { TransactionId, TransactionInitiator } from "../types.js";

export type FeeRequest =
  | Readonly<{ type: "legacy"; gasPrice?: Hex }>
  | Readonly<{
      type: "eip1559";
      maxFeePerGas?: Hex;
      maxPriorityFeePerGas?: Hex;
    }>;

export type Fee =
  | Readonly<{ type: "legacy"; gasPrice: Hex }>
  | Readonly<{
      type: "eip1559";
      maxFeePerGas: Hex;
      maxPriorityFeePerGas: Hex;
    }>;

export type TransactionRequest = Readonly<{
  to?: string;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  nonce?: Hex;
  fee?: FeeRequest;
}>;

export type PreparedTransaction = Readonly<{
  from: string;
  to: string | null;
  value: Hex;
  data: Hex;
  gas: Hex;
  nonce?: Hex;
  fee: Fee;
}>;

export type SignableTransaction = Omit<PreparedTransaction, "nonce"> &
  Readonly<{
    nonce: Hex;
  }>;

export type TransactionRecovery = Readonly<{
  rawTransaction: Hex;
}>;

export type SigningInput = Readonly<{
  chainRef: ChainRef;
  accountId: AccountId;
  transaction: SignableTransaction;
}>;

export type SignedTransaction = Readonly<{
  chainRef: ChainRef;
  transaction: SignableTransaction;
  recovery: TransactionRecovery;
}>;

export type TransactionConfirmation = Readonly<{
  blockHash: string;
  blockNumber: Hex;
  transactionIndex: Hex;
  gasUsed: Hex;
  effectiveGasPrice?: Hex;
  contractAddress?: string;
}>;

export type TransactionFailure =
  | Readonly<{
      type: "broadcast";
      code: number;
      message: string;
      data?: JsonValue;
    }>
  | Readonly<{
      type: "execution";
      inclusion: TransactionConfirmation;
    }>;

export type TransactionState =
  | Readonly<{ status: "pending" }>
  | Readonly<{
      status: "confirmed";
      confirmation: TransactionConfirmation;
    }>
  | Readonly<{
      status: "failed";
      failure: TransactionFailure;
    }>
  | Readonly<{
      status: "replaced";
      replacement: Readonly<{ type: "local"; transactionId: TransactionId }> | Readonly<{ type: "external" }>;
    }>
  | Readonly<{ status: "dropped" }>;

export type TerminalTransactionState = Exclude<TransactionState, Readonly<{ status: "pending" }>>;

export type Transaction = Readonly<{
  transactionId: TransactionId;
  namespace: "eip155";
  chainRef: ChainRef;
  accountId: AccountId;
  initiator: TransactionInitiator;
  replacesTransactionId?: TransactionId;
  transaction: SignableTransaction;
  state: TransactionState;
  createdAt: number;
  updatedAt: number;
}>;

export type BroadcastOutcome =
  | Readonly<{
      status: "accepted";
      transactionHash: Hex;
    }>
  | Readonly<{
      status: "unknown";
      transactionHash: Hex;
    }>
  | Readonly<{
      status: "rejected";
      failure: TransactionFailure;
    }>;

export type Submission =
  | Readonly<{
      status: "pending";
      transaction: Transaction;
      transactionHash: Hex;
    }>
  | Readonly<{
      status: "failed";
      transaction: Transaction;
    }>;
