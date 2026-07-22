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

export type FinalizedTransaction = Omit<PreparedTransaction, "nonce"> &
  Readonly<{
    nonce: Hex;
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

export type Transaction = Readonly<{
  transactionId: TransactionId;
  namespace: "eip155";
  chainRef: ChainRef;
  accountId: AccountId;
  initiator: TransactionInitiator;
  networkTransactionId: string;
  replacesTransactionId?: TransactionId;
  transaction: FinalizedTransaction;
  state: TransactionState;
  createdAt: number;
  updatedAt: number;
}>;
