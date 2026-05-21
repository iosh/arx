import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { AccountController } from "../controllers/account/types.js";
import type { ApprovalController } from "../controllers/approval/types.js";
import type { TransactionsService } from "../services/store/transactions/types.js";
import type { TransactionAccess } from "./access.js";
import { createTransactionAccess } from "./createTransactionAccess.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { createApprovalDetailInvalidations } from "./orchestration/createApprovalDetailInvalidations.js";
import { ProviderTransactionApprovalService } from "./orchestration/ProviderTransactionApprovalService.js";
import { TransactionExecutionPipeline } from "./orchestration/TransactionExecutionPipeline.js";
import { TransactionExecutionService } from "./orchestration/TransactionExecutionService.js";
import { createTransactionRecoveryService } from "./orchestration/TransactionRecoveryService.js";
import { TransactionSubmissionStore } from "./orchestration/TransactionSubmissionStore.js";
import { createTransactionApprovalReviewReader } from "./proposal/TransactionApprovalReviewService.js";
import { TransactionPrepare } from "./proposal/TransactionPrepare.js";
import { TransactionProposalApprovalService } from "./proposal/TransactionProposalApprovalService.js";
import { TransactionProposalBeginService } from "./proposal/TransactionProposalBeginService.js";
import { TransactionProposalDraftService } from "./proposal/TransactionProposalDraftService.js";
import { createTransactionProposalReader } from "./proposal/TransactionProposalReadService.js";
import { TransactionProposalRuntime } from "./proposal/TransactionProposalRuntime.js";
import { TransactionRecordRuntime } from "./record/TransactionRecordRuntime.js";
import { TransactionRecordViewStore } from "./record/TransactionRecordViewStore.js";
import type { ProviderTransactionApprovalCommands, TransactionRuntime } from "./runtime.js";
import type { TransactionMessenger } from "./topics.js";
import type { ReceiptTracker } from "./tracker/ReceiptTracker.js";

type TransactionClock = () => number;

const createTransactionClock = (readSystemTime: () => number): TransactionClock => {
  let lastTimestamp = 0;

  return () => {
    const currentTimestamp = readSystemTime();
    if (currentTimestamp <= lastTimestamp) {
      lastTimestamp += 1;
      return lastTimestamp;
    }

    lastTimestamp = currentTimestamp;
    return currentTimestamp;
  };
};

export type CreateTransactionRuntimeOptions = {
  messenger: TransactionMessenger;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress" | "toCanonicalAddressFromAccountKey">;
  accounts: Pick<AccountController, "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create" | "createPending" | "cancel" | "onFinished" | "listPendingIdsBySubject">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  now?: () => number;
  tracker?: ReceiptTracker;
  stateLimit?: number;
  logger?: (message: string, data?: unknown) => void;
};

export const createTransactionRuntime = (options: CreateTransactionRuntimeOptions): TransactionRuntime => {
  const readSystemTime = options.now ?? Date.now;
  const now = createTransactionClock(readSystemTime);
  const stateLimit = options.stateLimit ?? 200;
  const logger = options.logger ?? (() => {});

  const proposalRuntime = new TransactionProposalRuntime({
    messenger: options.messenger,
    accountCodecs: options.accountCodecs,
  });

  const recordView = new TransactionRecordViewStore({
    messenger: options.messenger,
    service: options.service,
    accountCodecs: options.accountCodecs,
    stateLimit,
    logger,
  });

  const submission = new TransactionSubmissionStore({
    stateLimit,
  });

  const records = new TransactionRecordRuntime({
    proposalRuntime,
    recordView,
    accountCodecs: options.accountCodecs,
    namespaces: options.namespaces,
    service: options.service,
    submission,
    ...(options.tracker ? { tracker: options.tracker } : {}),
  });

  const prepare = new TransactionPrepare({
    proposalRuntime,
    namespaces: options.namespaces,
    now,
    logger,
  });

  const review = createTransactionApprovalReviewReader({
    proposalRuntime,
    namespaces: options.namespaces,
  });

  const proposalBegin = new TransactionProposalBeginService({
    proposalRuntime,
    accountCodecs: options.accountCodecs,
    accounts: options.accounts,
    approvals: options.approvals,
    namespaces: options.namespaces,
    prepare,
    now,
    logger,
  });
  const proposalDraft = new TransactionProposalDraftService({
    proposalRuntime,
    namespaces: options.namespaces,
    prepare,
    now,
  });
  const proposalReader = createTransactionProposalReader({
    proposalRuntime,
    review,
  });
  const proposalApprovals = new TransactionProposalApprovalService({
    proposalRuntime,
    now,
  });
  const executionPipeline = new TransactionExecutionPipeline({
    messenger: options.messenger,
    proposalRuntime,
    namespaces: options.namespaces,
    submission,
    records,
    now,
  });

  const execution = new TransactionExecutionService({
    proposalApprovals,
    proposalRuntime,
    pipeline: executionPipeline,
    now,
  });

  const recovery = createTransactionRecoveryService({
    execution,
    records,
  });

  const approvalDetailInvalidations = createApprovalDetailInvalidations({
    messenger: options.messenger,
    approvals: options.approvals,
    proposalRuntime,
    recordView,
    now,
  });

  const proposalRuntimeReader = {
    getProposalStateSnapshot: (id: string) => proposalRuntime.getProposalStateSnapshot(id),
    getProposalSnapshot: (id: string) => proposalRuntime.getProposalSnapshot(id),
    getReviewState: (id: string) => proposalRuntime.getReviewState(id),
    onChanged: (handler: (transactionIds: string[]) => void) => proposalRuntime.onChanged(handler),
  };

  const providerCommands: ProviderTransactionApprovalCommands = new ProviderTransactionApprovalService({
    begin: proposalBegin,
    execution,
    submission,
  });

  const access: TransactionAccess = createTransactionAccess({
    proposalBegin,
    proposalDraft,
    execution,
    recovery,
    submission,
    proposalRuntime: proposalRuntimeReader,
    proposalReader,
    recordView,
    approvalDetailInvalidations,
    approvals: options.approvals,
    logger,
  });

  return {
    access,
    proposal: {
      begin: proposalBegin,
      draft: proposalDraft,
    },
    providerCommands,
    execution,
    recovery,
    submission,
    approvalDetailInvalidations,
    review,
    proposals: proposalReader,
    records: recordView,
  };
};
