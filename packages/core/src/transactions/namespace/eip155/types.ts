import type { Hex } from "ox/Hex";
import type { TransactionConflictKey } from "../../aggregate/types.js";
import type { Eip155TransactionRequest } from "../../types.js";
import type {
  BroadcastArtifact,
  BroadcastResult,
  SignedTransactionPayload,
  SubmittedTransactionInspection,
  TransactionBroadcastArtifactContext,
  TransactionBroadcastContext,
  TransactionFailure,
  TransactionFinalizeSubmitContext,
  TransactionFinalizeSubmitResult,
  TransactionPrepareContext,
  TransactionPrepareResult,
  TransactionProposalBlocker,
  TransactionProposalError,
  TransactionRecordContext,
  TransactionReplacementRequestContext,
  TransactionResourceKeyContext,
  TransactionReviewContext,
  TransactionSignContext,
  TransactionSignOptions,
} from "../types.js";
import type { Eip155SubmittedTransaction } from "./transactionTypes.js";
import type {
  Eip155PreparedTransaction,
  Eip155UnsignedTransaction,
  Eip155UnsignedTransactionDraft,
} from "./unsignedTransaction.js";

export type Eip155FeeMode = "legacy" | "eip1559" | "unknown";
export type Eip155CallParams = {
  from?: Hex;
  to?: Hex;
  value?: Hex;
  data?: Hex;
};

export type Eip155PrepareResult = TransactionPrepareResult<Eip155PreparedTransaction, Eip155UnsignedTransactionDraft>;

export type Eip155PrepareContext = Omit<TransactionPrepareContext, "namespace" | "request"> & {
  namespace: "eip155";
  request: Eip155TransactionRequest;
};

export type Eip155FinalizeSubmitContext = Omit<
  TransactionFinalizeSubmitContext<"eip155">,
  "preparedPayload" | "request" | "localActiveTransactions"
> & {
  request: Eip155TransactionRequest;
  preparedPayload: Eip155PreparedTransaction;
  localActiveTransactions: readonly {
    transactionId: string;
    status: "submitting" | "submitted";
    approvedPayload: Eip155UnsignedTransaction;
    conflictKey: TransactionConflictKey | null;
  }[];
};

export type Eip155ResourceKeyContext = Omit<TransactionResourceKeyContext<"eip155">, "preparedPayload" | "request"> & {
  request: Eip155TransactionRequest;
  preparedPayload: Eip155PreparedTransaction;
};

export type Eip155FinalizeSubmitResult =
  | {
      status: "approved";
      approvedPayload: Eip155UnsignedTransaction;
      conflictKey: TransactionConflictKey | null;
    }
  | Extract<TransactionFinalizeSubmitResult<"eip155">, { status: "blocked" | "failed" }>;

export type Eip155ReplacementRequestContext = Omit<
  TransactionReplacementRequestContext<"eip155">,
  "targetApprovedPayload" | "targetRequest"
> & {
  targetRequest: Eip155TransactionRequest;
  targetApprovedPayload: Eip155UnsignedTransaction;
};

export type Eip155BroadcastArtifactContext = Omit<
  TransactionBroadcastArtifactContext<"eip155">,
  "approvedPayload" | "request"
> & {
  request: Eip155TransactionRequest;
  approvedPayload: Eip155UnsignedTransaction;
};

export type Eip155BroadcastContext = Omit<TransactionBroadcastContext<"eip155">, "request"> & {
  request: Eip155TransactionRequest;
};

export type Eip155SignContext = Omit<TransactionSignContext, "namespace" | "request" | "from"> & {
  namespace: "eip155";
  from: string;
  request: Eip155TransactionRequest;
};

export type Eip155TrackingContext = TransactionRecordContext & {
  namespace: "eip155";
  submitted: Eip155SubmittedTransaction;
};

export type Eip155ApprovalReviewContext = Omit<TransactionReviewContext, "namespace" | "request" | "reviewSnapshot"> & {
  namespace: "eip155";
  request: Eip155TransactionRequest;
  reviewSnapshot: Eip155UnsignedTransactionDraft | null;
};

export type Eip155SignerContract = {
  signTransaction(
    context: Eip155SignContext,
    transaction: Eip155UnsignedTransaction,
    options?: TransactionSignOptions,
  ): Promise<SignedTransactionPayload>;
};

export type Eip155BroadcasterContract = {
  broadcast(context: Eip155PrepareContext, signed: SignedTransactionPayload): Promise<{ hash: `0x${string}` }>;
};

export type Eip155SubmissionContract = {
  createBroadcastArtifact(
    context: Eip155BroadcastArtifactContext,
    options?: TransactionSignOptions,
  ): Promise<BroadcastArtifact>;
  broadcast(context: Eip155BroadcastContext): Promise<BroadcastResult<"eip155">>;
};

export type Eip155TrackingInspection = SubmittedTransactionInspection<"eip155">;

export type Eip155TransactionFailure = TransactionFailure;

export type Eip155PrepareStepResult<TPatch> =
  | { status: "ok"; patch: TPatch }
  | { status: "blocked"; blocker: TransactionProposalBlocker; patch: TPatch }
  | { status: "failed"; error: TransactionProposalError; patch: TPatch };

// Resolver result types for testing and internal use
export type AddressResolutionResult = {
  prepared: Pick<Eip155UnsignedTransactionDraft, "from" | "to">;
};

export type FieldResolutionResult = {
  prepared: Eip155UnsignedTransactionDraft;
  payloadValues: Partial<
    Pick<Eip155UnsignedTransactionDraft, "gas" | "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas" | "nonce">
  >;
};

export type GasResolutionResult = {
  prepared: Partial<Pick<Eip155UnsignedTransactionDraft, "nonce" | "gas">>;
};

export type FeeResolutionResult = {
  prepared: Partial<Pick<Eip155UnsignedTransactionDraft, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">>;
};
