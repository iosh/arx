import type { Hex } from "ox/Hex";
import type { ChainRef } from "../chains/ids.js";
import type { AccountAddress } from "../controllers/account/types.js";

export type TransactionError = {
  name: string;
  message: string;
  code?: number | undefined;
  data?: unknown;
};

export type TransactionCaller = {
  origin: string;
};

export type TransactionPayload = Record<string, unknown>;

export type Eip155TransactionAccessListEntry = {
  address: AccountAddress;
  storageKeys: Hex[];
};

export type Eip155TransactionPayload = {
  chainId?: Hex;
  from?: AccountAddress;
  to?: AccountAddress | null;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  nonce?: Hex;
};

export type Eip155TransactionPayloadWithFrom = Eip155TransactionPayload & { from: AccountAddress };

export type Eip155PreparedTransaction = {
  from?: Hex;
  to?: Hex | null;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  nonce?: Hex;
  chainId?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
};

export type Eip155TransactionDraftChange = {
  field: "gas" | "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas" | "nonce";
  value: string | null;
};

export type Eip155TransactionReceipt = {
  status?: Hex;
  transactionHash?: Hex;
  blockNumber?: Hex;
  [key: string]: unknown;
};

export type Eip155SubmittedTransaction = {
  hash: Hex;
  chainId: Hex;
  from: AccountAddress;
  to?: AccountAddress | null;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  nonce: Hex;
  type?: Hex | null;
  gasPrice?: Hex | null;
  maxFeePerGas?: Hex | null;
  maxPriorityFeePerGas?: Hex | null;
  accessList?: Eip155TransactionAccessListEntry[];
};

export type Eip155TransactionDraftEdit = {
  namespace: "eip155";
  changes: readonly Eip155TransactionDraftChange[];
};

export type NamespaceTransactionShapeMap = {
  eip155: {
    payload: Eip155TransactionPayload;
    draftEdit: Eip155TransactionDraftEdit;
    prepared: Eip155PreparedTransaction;
    submitted: Eip155SubmittedTransaction;
    receipt: Eip155TransactionReceipt;
  };
};

export type TransactionNamespace = keyof NamespaceTransactionShapeMap;
export type AnyNamespaceTransactionDraftEdit = {
  [TNamespace in TransactionNamespace]: NamespaceTransactionShapeMap[TNamespace]["draftEdit"];
}[TransactionNamespace];

type NamespaceShape<
  TNamespace extends string,
  TKey extends keyof NamespaceTransactionShapeMap[TransactionNamespace],
  TFallback,
> = TNamespace extends TransactionNamespace ? NamespaceTransactionShapeMap[TNamespace][TKey] : TFallback;

export type TransactionRequest<
  TNamespace extends string = string,
  TPayload extends TransactionPayload = NamespaceShape<TNamespace, "payload", TransactionPayload>,
> = {
  namespace: TNamespace;
  chainRef: ChainRef;
  payload: TPayload;
};

export type Eip155TransactionRequest = TransactionRequest<"eip155", Eip155TransactionPayload>;

export type TransactionPrepared<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "prepared",
  Record<string, unknown>
>;

export type TransactionSubmitted<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "submitted",
  Record<string, unknown>
>;

export type TransactionReceipt<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "receipt",
  Record<string, unknown>
>;

export type NamespaceTransactionDraftEdit<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "draftEdit",
  AnyNamespaceTransactionDraftEdit
>;
