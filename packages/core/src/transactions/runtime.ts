import type { TransactionAccess } from "./access.js";
import type {
  ApprovalDetailInvalidationEvents,
  TransactionApprovalExecutor,
  TransactionRecoveryRuntime,
  TransactionSubmissionTracker,
} from "./orchestration/types.js";
import type {
  TransactionApprovalReviewReader,
  TransactionProposalCommandSet,
  TransactionProposalReader,
} from "./proposal/types.js";
import type { ProviderTransactionApprovalCommands } from "./provider/types.js";
import type { TransactionRecordReader } from "./record/types.js";

export type {
  ApprovalDetailInvalidation,
  TransactionBroadcastStartedChange,
  TransactionProposalStatusChange,
  TransactionRecordStatusChange,
  TransactionStatusChange,
  TransactionSubmittedChange,
} from "./events.js";
export type {
  ApprovalDetailInvalidationEvents,
  TransactionApprovalExecutor,
  TransactionApprovalFailureReason,
  TransactionApprovalResult,
  TransactionRecoveryRuntime,
  TransactionSubmissionFailure,
  TransactionSubmissionPersistenceFailure,
  TransactionSubmissionResolution,
  TransactionSubmissionTracker,
} from "./orchestration/types.js";
export {
  isTransactionSubmissionError,
  isTransactionSubmissionPersistenceError,
  TransactionSubmissionError,
  TransactionSubmissionPersistenceError,
} from "./orchestration/types.js";
export type { TransactionProposalTerminationReason } from "./proposal/index.js";
export type {
  TransactionApprovalReviewReader,
  TransactionProposalBeginCommands,
  TransactionProposalCommandSet,
  TransactionProposalDraftCommands,
  TransactionProposalMeta,
  TransactionProposalPrepareSnapshot,
  TransactionProposalReader,
  TransactionProposalReviewState,
  TransactionProposalReviewView,
  TransactionProposalRuntimeReader,
  TransactionProposalSnapshot,
  TransactionProposalStateSnapshot,
  TransactionReviewRuntimeStatus,
} from "./proposal/types.js";
export type {
  BeginTransactionApprovalOptions,
  ProviderTransactionApprovalCommands,
  ProviderTransactionSubmission,
  TransactionApprovalRequestRef,
  TransactionApprovalReservation,
  TransactionRequestBinding,
} from "./provider/types.js";
export type { TransactionRecordStatus, TransactionRecordView } from "./record/index.js";
export type { TransactionRecordReader } from "./record/types.js";

export type TransactionRuntime = Readonly<{
  access: TransactionAccess;
  proposal: TransactionProposalCommandSet;
  providerCommands: ProviderTransactionApprovalCommands;
  execution: TransactionApprovalExecutor;
  recovery: TransactionRecoveryRuntime;
  submission: TransactionSubmissionTracker;
  approvalDetailInvalidations: ApprovalDetailInvalidationEvents;
  review: TransactionApprovalReviewReader;
  proposals: TransactionProposalReader;
  records: TransactionRecordReader;
}>;
