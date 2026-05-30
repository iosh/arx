import type { Hex } from "ox/Hex";
import type { AccountAddress } from "../../../controllers/account/types.js";
import type { Eip155TransactionRequest } from "../../types.js";
import type {
  SignedTransactionPayload,
  TransactionApprovalReviewContext,
  TransactionDraftEditContext,
  TransactionPrepareContext,
  TransactionPrepareResult,
  TransactionProposalBlocker,
  TransactionProposalError,
  TransactionRecordContext,
  TransactionSignContext,
  TransactionSignOptions,
} from "../types.js";
import type { Eip155SubmittedTransaction, Eip155TransactionDraftChange } from "./transactionTypes.js";
import type { Eip155UnsignedTransaction, Eip155UnsignedTransactionDraft } from "./unsignedTransaction.js";

export type Eip155FeeMode = "legacy" | "eip1559" | "unknown";
export type Eip155CallParams = {
  from?: Hex;
  to?: Hex;
  value?: Hex;
  data?: Hex;
};

export type Eip155PrepareResult = TransactionPrepareResult<Eip155UnsignedTransaction, Eip155UnsignedTransactionDraft>;

export type Eip155PrepareContext = Omit<TransactionPrepareContext, "namespace" | "request"> & {
  namespace: "eip155";
  request: Eip155TransactionRequest;
};

export type Eip155SignContext = Omit<TransactionSignContext, "namespace" | "request" | "from"> & {
  namespace: "eip155";
  from: AccountAddress;
  request: Eip155TransactionRequest;
};

export type Eip155TrackingContext = TransactionRecordContext & {
  namespace: "eip155";
  submitted: Eip155SubmittedTransaction;
};

export type Eip155ApprovalReviewContext = Omit<
  TransactionApprovalReviewContext,
  "namespace" | "request" | "reviewSnapshot"
> & {
  namespace: "eip155";
  request: Eip155TransactionRequest;
  reviewSnapshot: Eip155UnsignedTransactionDraft | null;
};

export type Eip155DraftEditContext = Omit<TransactionDraftEditContext, "namespace" | "request" | "edit"> & {
  namespace: "eip155";
  request: Eip155TransactionRequest;
  edit: {
    namespace: "eip155";
    changes: readonly Eip155TransactionDraftChange[];
  };
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
