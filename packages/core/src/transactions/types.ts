import type { ChainRef } from "../chains/ids.js";
import type {
  Eip155SubmittedTransaction,
  Eip155TransactionDraftChange,
  Eip155TransactionDraftEdit,
  Eip155TransactionPayload,
  Eip155TransactionPayloadWithFrom,
  Eip155TransactionReceipt,
} from "./namespace/eip155/transactionTypes.js";
import type {
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

export type TransactionPayload = Record<string, unknown>;

export type NamespaceTransactionShapeMap = {
  eip155: {
    payload: Eip155TransactionPayload;
    draftEdit: Eip155TransactionDraftEdit;
    prepared: Eip155UnsignedTransaction;
    reviewSnapshot: Eip155UnsignedTransactionDraft;
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
  Record<string, unknown>
>;

export type TransactionReviewSnapshot<TNamespace extends string = string> = NamespaceShape<
  TNamespace,
  "reviewSnapshot",
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

export type {
  Eip155SubmittedTransaction,
  Eip155TransactionDraftChange,
  Eip155TransactionDraftEdit,
  Eip155TransactionPayload,
  Eip155TransactionPayloadWithFrom,
  Eip155TransactionReceipt,
};
