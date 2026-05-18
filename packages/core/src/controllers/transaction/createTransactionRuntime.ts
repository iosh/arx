import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionAccess } from "../../transactions/access.js";
import { createTransactionAccess } from "../../transactions/createTransactionAccess.js";
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
import { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";
import { TransactionRecordRuntime } from "./TransactionRecordRuntime.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { createTransactionRecoveryService } from "./TransactionRecoveryService.js";
import { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import type { TransactionMessenger } from "./topics.js";
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
    getProposalStateSnapshot: (id: string) => proposalRuntime.getStateSnapshot(id),
    getView: (id: string) => proposalRuntime.getView(id),
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
