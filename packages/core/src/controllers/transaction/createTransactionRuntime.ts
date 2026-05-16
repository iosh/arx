import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { AccountController } from "../account/types.js";
import type { ApprovalController } from "../approval/types.js";
import { createApprovalDetailInvalidations } from "./createApprovalDetailInvalidations.js";
import { ProviderTransactionApprovalService } from "./ProviderTransactionApprovalService.js";
import { createTransactionApprovalReviewReader } from "./TransactionApprovalReviewService.js";
import { TransactionExecutionPipeline } from "./TransactionExecutionPipeline.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TransactionPrepare } from "./TransactionPrepare.js";
import { TransactionProposalApprovalService } from "./TransactionProposalApprovalService.js";
import { TransactionProposalBeginService } from "./TransactionProposalBeginService.js";
import { TransactionProposalDraftService } from "./TransactionProposalDraftService.js";
import { createTransactionProposalReader } from "./TransactionProposalReadService.js";
import { TransactionProposalStore } from "./TransactionProposalStore.js";
import { TransactionRecordRuntime } from "./TransactionRecordRuntime.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { createTransactionRecoveryService } from "./TransactionRecoveryService.js";
import { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import type { ProviderTransactionApprovalCommands, TransactionRuntime } from "./types.js";

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
  const now = createTransactionClock(readSystemTime);
  const stateLimit = options.stateLimit ?? 200;
  const logger = options.logger ?? (() => {});

  const proposalStore = new TransactionProposalStore({
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
    proposalStore,
    recordView,
    accountCodecs: options.accountCodecs,
    namespaces: options.namespaces,
    service: options.service,
    submission,
    ...(options.tracker ? { tracker: options.tracker } : {}),
  });

  const prepare = new TransactionPrepare({
    proposalStore,
    namespaces: options.namespaces,
    now,
    logger,
  });

  const review = createTransactionApprovalReviewReader({
    proposalStore,
    namespaces: options.namespaces,
  });

  const proposalBegin = new TransactionProposalBeginService({
    proposalStore,
    accountCodecs: options.accountCodecs,
    accounts: options.accounts,
    approvals: options.approvals,
    namespaces: options.namespaces,
    prepare,
    now,
  });
  const proposalDraft = new TransactionProposalDraftService({
    proposalStore,
    namespaces: options.namespaces,
    prepare,
    now,
  });
  const proposalReader = createTransactionProposalReader({
    proposalStore,
    review,
  });
  const proposalApprovals = new TransactionProposalApprovalService({
    proposalStore,
    now,
  });
  const executionPipeline = new TransactionExecutionPipeline({
    messenger: options.messenger,
    proposalStore,
    namespaces: options.namespaces,
    submission,
    records,
    now,
  });

  const execution = new TransactionExecutionService({
    proposalApprovals,
    proposalStore,
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
    proposalStore,
    recordView,
    now,
  });

  const providerCommands: ProviderTransactionApprovalCommands = new ProviderTransactionApprovalService({
    begin: proposalBegin,
    execution,
    submission,
  });

  return {
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
