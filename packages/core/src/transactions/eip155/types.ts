import type { AccessList } from "ox/AccessList";
import type { Address } from "ox/Address";
import type { Hex } from "ox/Hex";
import type { AccountId } from "../../accounts/accountId.js";
import type { JsonValue } from "../../errors.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { TransactionId, TransactionInitiator, TransactionReplacementType } from "../types.js";

type TransactionRequestFields = Readonly<{
  to?: Address | null | undefined;
  value?: Hex | undefined;
  data?: Hex | undefined;
  gas?: Hex | undefined;
}>;

export type AutoTransactionRequest = TransactionRequestFields & Readonly<{ type: "auto" }>;

export type LegacyTransactionRequest = TransactionRequestFields &
  Readonly<{
    type: "legacy";
    gasPrice?: Hex | undefined;
  }>;

export type Eip2930TransactionRequest = TransactionRequestFields &
  Readonly<{
    type: "eip2930";
    gasPrice?: Hex | undefined;
    accessList?: AccessList | undefined;
  }>;

export type Eip1559TransactionRequest = TransactionRequestFields &
  Readonly<{
    type: "eip1559";
    maxFeePerGas?: Hex | undefined;
    maxPriorityFeePerGas?: Hex | undefined;
    accessList?: AccessList | undefined;
  }>;

export type TransactionRequest =
  | AutoTransactionRequest
  | LegacyTransactionRequest
  | Eip2930TransactionRequest
  | Eip1559TransactionRequest;

type PreparedTransactionFields = Readonly<{
  from: Address;
  to: Address | null;
  value: Hex;
  data: Hex;
  gas: Hex;
}>;

export type LegacyPreparedTransaction = PreparedTransactionFields &
  Readonly<{
    type: "legacy";
    gasPrice: Hex;
  }>;

export type Eip2930PreparedTransaction = PreparedTransactionFields &
  Readonly<{
    type: "eip2930";
    gasPrice: Hex;
    accessList: AccessList;
  }>;

export type Eip1559PreparedTransaction = PreparedTransactionFields &
  Readonly<{
    type: "eip1559";
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
    accessList: AccessList;
  }>;

export type PreparedTransaction = LegacyPreparedTransaction | Eip2930PreparedTransaction | Eip1559PreparedTransaction;

export type SignableTransaction = PreparedTransaction & Readonly<{ nonce: Hex }>;

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
  hash: Hex;
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

export type TransactionBroadcastFailure = Extract<TransactionFailure, Readonly<{ type: "broadcast" }>>;

export type TransactionState =
  | Readonly<{ status: "pending" }>
  | Readonly<{
      /** The wallet observed a successful receipt and ended tracking. */
      status: "confirmed";
      confirmation: TransactionConfirmation;
    }>
  | Readonly<{
      status: "failed";
      failure: TransactionFailure;
    }>
  | Readonly<{
      status: "replaced";
      replacement:
        | Readonly<{ type: "local"; transactionId: TransactionId }>
        | Readonly<{ type: "external"; hash?: Hex }>;
    }>
  | Readonly<{
      /** The wallet ended tracking with the on-chain execution result still unknown. */
      status: "dropped";
    }>;

export type TerminalTransactionState = Exclude<TransactionState, Readonly<{ status: "pending" }>>;

export type Transaction = Readonly<{
  transactionId: TransactionId;
  namespace: "eip155";
  chainRef: ChainRef;
  accountId: AccountId;
  initiator: TransactionInitiator;
  replacesTransactionId?: TransactionId;
  replacementType?: TransactionReplacementType;
  /** May be absent for transactions that reached a terminal state before hash persistence. */
  hash?: Hex;
  transaction: SignableTransaction;
  state: TransactionState;
  createdAt: number;
  updatedAt: number;
}>;

export type BroadcastOutcome =
  | Readonly<{ status: "pending" }>
  | Readonly<{
      status: "rejected";
      failure: TransactionBroadcastFailure;
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
      failure: TransactionBroadcastFailure;
    }>;
