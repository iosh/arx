import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { ApprovalRequester } from "../../controllers/approval/types.js";
import type { TransactionIntent } from "../intent/index.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalIdentity,
  TransactionApprovalRequestRef,
} from "../provider/types.js";
import type { SendTransactionApprovalReview } from "../review/types.js";
import type {
  NamespaceTransactionDraftEdit,
  TransactionCaller,
  TransactionPrepared,
  TransactionRequest,
} from "../types.js";
import type { TransactionProposal, TransactionProposalStatus, TransactionProposalTermination } from "./index.js";

type TransactionMetaBase = {
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  requestedAddress?: string | undefined;
  createdAt: number;
  updatedAt: number;
};

export type TransactionProposalMeta = TransactionMetaBase & {
  approvalId: string;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  status: TransactionProposalStatus;
  termination?: TransactionProposalTermination | undefined;
  submitted?: never;
  receipt?: never;
  replacedByRecordId?: never;
};

export type TransactionProposalPrepareSnapshot = {
  requestRevision: number;
  sessionToken: string;
  status: TransactionProposal["prepare"]["status"];
  prepared: TransactionPrepared | null;
  reviewSnapshot: TransactionPrepared | null;
  blocker?: TransactionProposal["prepare"]["blocker"];
  error?: TransactionProposal["prepare"]["error"];
  invalidatedBy?: string | undefined;
};

export type TransactionProposalStateSnapshot = {
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  requestedAddress?: string | undefined;
  request: TransactionRequest;
  fromAccountKey: string;
  status: TransactionProposalStatus;
  termination?: TransactionProposalTermination | undefined;
  createdAt: number;
  updatedAt: number;
  prepare: TransactionProposalPrepareSnapshot;
};

export type TransactionReviewRuntimeStatus = "preparing" | "ready" | "blocked" | "failed" | "invalidated";

export type TransactionProposalReviewState = {
  sessionToken: string;
  status: TransactionReviewRuntimeStatus;
  updatedAt: number;
  reviewPreparedSnapshot: TransactionPrepared | null;
  error: TransactionProposal["prepare"]["error"] | null;
  blocker: TransactionProposal["prepare"]["blocker"] | null;
  invalidatedBy?: string | undefined;
};

export type TransactionProposalSnapshot = {
  kind: "proposal";
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  requestedAddress?: string | undefined;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  status: TransactionProposalStatus;
  termination?: TransactionProposalTermination | undefined;
  createdAt: number;
  updatedAt: number;
};

export type TransactionProposalReviewView = TransactionProposalSnapshot & {
  review?: SendTransactionApprovalReview | undefined;
};

export type TransactionApprovalReviewReader = {
  getTransactionApprovalReview(transactionId: string): SendTransactionApprovalReview;
};

export type TransactionProposalBeginCommands = {
  createProposal(
    intent: TransactionIntent,
    caller: TransactionCaller,
    approvalIdentity?: TransactionApprovalIdentity | null,
  ): TransactionProposalMeta;
  requestApproval(
    proposalMeta: TransactionProposalMeta,
    requester: ApprovalRequester,
  ): string;
  beginTransactionApproval(
    intent: TransactionIntent,
    requester: ApprovalRequester,
    options: BeginTransactionApprovalOptions,
  ): TransactionApprovalRequestRef;
};

export type TransactionProposalDraftCommands = {
  rerunPrepare(transactionId: string): Promise<void>;
  applyDraftEdit(input: { transactionId: string; edit: NamespaceTransactionDraftEdit; mode?: string }): Promise<void>;
};

export type TransactionProposalCommandSet = Readonly<{
  begin: TransactionProposalBeginCommands;
  draft: TransactionProposalDraftCommands;
}>;

export type TransactionProposalReader = {
  getProposalReviewView(id: string): TransactionProposalReviewView | undefined;
};

export type TransactionProposalRuntimeReader = {
  getProposalStateSnapshot(id: string): TransactionProposalStateSnapshot | undefined;
  getProposalSnapshot(id: string): TransactionProposalSnapshot | undefined;
  getReviewState(id: string): TransactionProposalReviewState | null;
  onChanged(handler: (transactionIds: string[]) => void): () => void;
};
