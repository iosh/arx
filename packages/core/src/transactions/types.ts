import type { ChainRef } from "../chains/ids.js";
import type { JsonObject } from "./aggregate/json.js";
import type {
  Eip155RawTransactionArtifact,
  Eip155SubmittedTransaction,
  Eip155TransactionPayload,
  Eip155TransactionPayloadWithFrom,
  Eip155TransactionReceipt,
} from "./namespace/eip155/transactionTypes.js";
import type {
  Eip155PreparedTransaction,
  Eip155UnsignedTransaction,
  Eip155UnsignedTransactionDraft,
} from "./namespace/eip155/unsignedTransaction.js";

export type TransactionError = {
  name: string;
  message: string;
  code?: number | undefined;
  data?: unknown;
};

export type TransactionCaller = {
  origin: string;
};

export type TransactionPayload = JsonObject;

export type NamespaceTransactionShapeMap = {
  eip155: {
    payload: Eip155TransactionPayload;
    prepared: Eip155PreparedTransaction;
    approved: Eip155UnsignedTransaction;
    reviewSnapshot: Eip155UnsignedTransactionDraft;
    broadcastArtifact: Eip155RawTransactionArtifact;
    submitted: Eip155SubmittedTransaction;
    receipt: Eip155TransactionReceipt;
  };
};

export type TransactionNamespace = keyof NamespaceTransactionShapeMap;

type NamespaceShape<
  TNamespace extends string,
  TKey extends keyof NamespaceTransactionShapeMap[TransactionNamespace],
  TFallback,
> = TNamespace extends TransactionNamespace ? NamespaceTransactionShapeMap[TNamespace][TKey] : TFallback;

export type WalletTransactionRequest<
  TNamespace extends string = string,
  TPayload extends TransactionPayload = NamespaceShape<TNamespace, "payload", TransactionPayload>,
> = {
  namespace: TNamespace;
  payload: TPayload;
};

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
  JsonObject
>;

export type TransactionApproved<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "approved",
  JsonObject
>;

export type TransactionReviewSnapshot<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "reviewSnapshot",
  JsonObject
>;

export type TransactionBroadcastArtifact<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "broadcastArtifact",
  { kind: string; payload: JsonObject }
>;

export type TransactionSubmitted<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "submitted",
  JsonObject
>;

export type TransactionReceipt<TNamespace extends string = string> = NamespaceShape<TNamespace, "receipt", JsonObject>;

export type {
  Eip155RawTransactionArtifact,
  Eip155SubmittedTransaction,
  Eip155TransactionPayload,
  Eip155TransactionPayloadWithFrom,
  Eip155TransactionReceipt,
};
