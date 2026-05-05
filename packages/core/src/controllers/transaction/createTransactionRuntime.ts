import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { AccountController } from "../account/types.js";
import type { ApprovalController, ApprovalFinishedEvent } from "../approval/types.js";
import { ProviderTransactionApprovalService } from "./ProviderTransactionApprovalService.js";
import { createTransactionApprovalReviewReader } from "./TransactionApprovalReviewService.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionProposalBeginService } from "./TransactionProposalBeginService.js";
import { TransactionProposalDraftService } from "./TransactionProposalDraftService.js";
import { createTransactionProposalExecutionGate } from "./TransactionProposalExecutionGate.js";
import { createTransactionProposalReader } from "./TransactionProposalReadService.js";
import { TransactionProposalStore } from "./TransactionProposalStore.js";
import { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";
import { TransactionStateChangePublisher } from "./TransactionStateChangePublisher.js";
import { TransactionSubmissionService } from "./TransactionSubmissionService.js";
import type { ProviderTransactionApprovalCommands, TransactionRuntime } from "./types.js";

type TransactionTimestampReader = () => number;

const createTransactionTimestampReader = (readSystemTime: () => number): TransactionTimestampReader => {
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
  messenger: import("./topics.js").TransactionMessenger;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress" | "toCanonicalAddressFromAccountKey">;
  accounts: Pick<AccountController, "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create" | "onFinished" | "listPendingIdsBySubject">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  now?: () => number;
  tracker?: ReceiptTracker;
  stateLimit?: number;
  logger?: (message: string, data?: unknown) => void;
};

export const createTransactionRuntime = (options: CreateTransactionRuntimeOptions): TransactionRuntime => {
  const readSystemTime = options.now ?? Date.now;
  const readTransactionTimestamp = createTransactionTimestampReader(readSystemTime);
  const stateLimit = options.stateLimit ?? 200;
  const logger = options.logger ?? (() => {});

  const proposalStore = new TransactionProposalStore({
    messenger: options.messenger,
    accountCodecs: options.accountCodecs,
  });
  const reviewSessions = new TransactionReviewSessionStore();

  const recordView = new TransactionRecordViewStore({
    messenger: options.messenger,
    service: options.service,
    accountCodecs: options.accountCodecs,
    stateLimit,
    logger,
  });

  const submission = new TransactionSubmissionService({
    recordView,
    stateLimit,
  });

  const tracking = new TransactionReceiptTracking({
    recordView,
    namespaces: options.namespaces,
    service: options.service,
    ...(options.tracker ? { tracker: options.tracker } : {}),
  });

  const prepare = new TransactionPrepareManager({
    proposalStore,
    reviewSessions,
    namespaces: options.namespaces,
    logger,
  });

  const review = createTransactionApprovalReviewReader({
    proposalStore,
    reviewSessions,
    namespaces: options.namespaces,
  });

  const proposalBegin = new TransactionProposalBeginService({
    proposalStore,
    reviewSessions,
    accountCodecs: options.accountCodecs,
    accounts: options.accounts,
    approvals: options.approvals,
    namespaces: options.namespaces,
    prepare,
    readTransactionTimestamp,
  });
  const proposalDraft = new TransactionProposalDraftService({
    proposalStore,
    reviewSessions,
    namespaces: options.namespaces,
    prepare,
    readTransactionTimestamp,
  });
  const proposalReader = createTransactionProposalReader({
    proposalStore,
    review,
  });
  const proposalExecution = createTransactionProposalExecutionGate({
    proposalStore,
    reviewSessions,
    readTransactionTimestamp,
  });

  const execution = new TransactionExecutionService({
    messenger: options.messenger,
    proposalStore,
    reviewSessions,
    recordView,
    accountCodecs: options.accountCodecs,
    namespaces: options.namespaces,
    service: options.service,
    submissionService: submission,
    prepare,
    proposals: proposalExecution,
    tracking,
    readTransactionTimestamp,
  });

  const stateChanges = new TransactionStateChangePublisher({
    messenger: options.messenger,
    approvals: options.approvals,
  });

  proposalStore.onChanged((transactionIds) => stateChanges.enqueue({ transactionIds }));
  reviewSessions.onChanged((transactionIds) => stateChanges.enqueue({ transactionIds }));
  recordView.onChanged((transactionIds) => stateChanges.enqueue({ transactionIds }));

  options.approvals.onFinished((event: ApprovalFinishedEvent<unknown>) => {
    reviewSessions.invalidateReviewFromApproval(event, readTransactionTimestamp());
    if (event.subject?.kind === "transaction") {
      stateChanges.enqueue({
        transactionIds: [event.subject.transactionId],
        approvalIds: [event.approvalId],
      });
    }
  });

  const providerCommands: ProviderTransactionApprovalCommands = new ProviderTransactionApprovalService({
    begin: proposalBegin,
    execution,
    submission,
    proposals: proposalReader,
    records: recordView,
  });

  return {
    proposal: {
      begin: proposalBegin,
      draft: proposalDraft,
    },
    providerCommands,
    execution,
    recovery: execution,
    submission,
    stateChanges,
    review,
    proposals: proposalReader,
    records: recordView,
  };
};
