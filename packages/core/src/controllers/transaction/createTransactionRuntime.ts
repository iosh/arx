import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { AccountController } from "../account/types.js";
import type { ApprovalController, ApprovalFinishedEvent } from "../approval/types.js";
import type { SupportedChainsController } from "../supportedChains/types.js";
import { ProviderTransactionApprovalService } from "./ProviderTransactionApprovalService.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionProposalService } from "./TransactionProposalService.js";
import { TransactionProposalStore } from "./TransactionProposalStore.js";
import { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
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
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  supportedChains: Pick<SupportedChainsController, "getChain">;
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
    namespaces: options.namespaces,
    logger,
  });

  const proposals = new TransactionProposalService({
    proposalStore,
    accountCodecs: options.accountCodecs,
    networkSelection: options.networkSelection,
    supportedChains: options.supportedChains,
    accounts: options.accounts,
    approvals: options.approvals,
    namespaces: options.namespaces,
    prepare,
    readTransactionTimestamp,
  });

  const execution = new TransactionExecutionService({
    messenger: options.messenger,
    proposalStore,
    recordView,
    accountCodecs: options.accountCodecs,
    namespaces: options.namespaces,
    service: options.service,
    submissionService: submission,
    prepare,
    proposals,
    tracking,
    readTransactionTimestamp,
  });

  const stateChanges = new TransactionStateChangePublisher({
    messenger: options.messenger,
    approvals: options.approvals,
  });

  proposalStore.onChanged((transactionIds) => stateChanges.enqueue({ transactionIds }));
  recordView.onChanged((transactionIds) => stateChanges.enqueue({ transactionIds }));

  options.approvals.onFinished((event: ApprovalFinishedEvent<unknown>) => {
    proposals.invalidateFromApproval(event);
    if (event.subject?.kind === "transaction") {
      stateChanges.enqueue({
        transactionIds: [event.subject.transactionId],
        approvalIds: [event.approvalId],
      });
    }
  });

  const commands = proposals;
  const providerCommands: ProviderTransactionApprovalCommands = new ProviderTransactionApprovalService({
    commands,
    execution,
    submission,
    proposals,
    records: recordView,
  });

  return {
    commands,
    providerCommands,
    execution,
    recovery: execution,
    submission,
    stateChanges,
    review: proposals,
    proposals,
    records: recordView,
  };
};
