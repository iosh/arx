import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { ApprovalController } from "../approval/types.js";
import type { SupportedChainsController } from "../supportedChains/types.js";
import { isProposalTerminal, isTransactionRecordTerminal } from "./status.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionProposalService } from "./TransactionProposalService.js";
import { TransactionProposalStore } from "./TransactionProposalStore.js";
import { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { TransactionSubmissionService } from "./TransactionSubmissionService.js";
import {
  TRANSACTION_STATE_CHANGED,
  TRANSACTION_STATUS_CHANGED,
  type TransactionMessenger,
} from "./topics.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalHandoff,
  TransactionController,
  TransactionError,
  TransactionRequest,
  TransactionStateChange,
  TransactionStatusChange,
  TransactionSubmissionResolution,
  TransactionView,
} from "./types.js";

const createTransactionTransportDisconnectedError = (): TransactionError => ({
  name: "TransportDisconnectedError",
  message: "Transport disconnected.",
  code: 4900,
});

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

export type StoreTransactionControllerOptions = {
  messenger: TransactionMessenger;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress" | "toCanonicalAddressFromAccountKey">;
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  supportedChains: Pick<SupportedChainsController, "getChain">;
  accounts: Pick<AccountController, "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create" | "onFinished" | "listPendingIdsBySubject">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  now?: () => number;
  tracker?: ReceiptTracker;
  /**
   * Cache size for synchronous reads (e.g. getView()).
   * This is not a persistence boundary.
   */
  stateLimit?: number;
  logger?: (message: string, data?: unknown) => void;
};

/**
 * Transaction facade.
 *
 * Runtime proposals stay in memory; durable records are store-backed and start
 * after broadcast succeeds.
 */
export class StoreTransactionController implements TransactionController {
  #messenger: TransactionMessenger;
  #approvals: Pick<ApprovalController, "listPendingIdsBySubject">;
  #proposalStore: TransactionProposalStore;
  #recordView: TransactionRecordViewStore;
  #submissionService: TransactionSubmissionService;
  #proposals: TransactionProposalService;
  #execution: TransactionExecutionService;
  #pendingStateTransactionIds = new Set<string>();
  #pendingStateApprovalIds = new Set<string>();
  #stateFlushScheduled = false;

  constructor(options: StoreTransactionControllerOptions) {
    this.#messenger = options.messenger;
    this.#approvals = options.approvals;

    const readSystemTime = options.now ?? Date.now;
    const readTransactionTimestamp = createTransactionTimestampReader(readSystemTime);
    const stateLimit = options.stateLimit ?? 200;
    const logger = options.logger ?? (() => {});

    this.#proposalStore = new TransactionProposalStore({
      messenger: options.messenger,
      accountCodecs: options.accountCodecs,
    });

    this.#recordView = new TransactionRecordViewStore({
      messenger: options.messenger,
      service: options.service,
      accountCodecs: options.accountCodecs,
      stateLimit,
      logger,
    });

    this.#submissionService = new TransactionSubmissionService({
      recordView: this.#recordView,
      stateLimit,
    });

    const tracking = new TransactionReceiptTracking({
      recordView: this.#recordView,
      namespaces: options.namespaces,
      service: options.service,
      ...(options.tracker ? { tracker: options.tracker } : {}),
    });

    const prepare = new TransactionPrepareManager({
      proposalStore: this.#proposalStore,
      namespaces: options.namespaces,
      logger,
    });

    this.#proposals = new TransactionProposalService({
      proposalStore: this.#proposalStore,
      recordView: this.#recordView,
      accountCodecs: options.accountCodecs,
      networkSelection: options.networkSelection,
      supportedChains: options.supportedChains,
      accounts: options.accounts,
      approvals: options.approvals,
      namespaces: options.namespaces,
      prepare,
      readTransactionTimestamp,
    });

    this.#execution = new TransactionExecutionService({
      messenger: options.messenger,
      proposalStore: this.#proposalStore,
      recordView: this.#recordView,
      accountCodecs: options.accountCodecs,
      namespaces: options.namespaces,
      service: options.service,
      submissionService: this.#submissionService,
      prepare,
      proposals: this.#proposals,
      tracking,
      readTransactionTimestamp,
    });

    this.#proposalStore.onChanged((transactionIds) => this.#enqueueStateChange({ transactionIds }));
    this.#recordView.onChanged((transactionIds) => this.#enqueueStateChange({ transactionIds }));

    options.approvals.onFinished((event) => {
      this.#proposals.invalidateFromApproval(event);
      if (event.subject?.kind === "transaction") {
        this.#enqueueStateChange({
          transactionIds: [event.subject.transactionId],
          approvalIds: [event.approvalId],
        });
      }
    });
  }

  getView(id: string): TransactionView | undefined {
    return this.#proposals.getView(id);
  }

  getApprovalReview(input: Parameters<TransactionController["getApprovalReview"]>[0]) {
    return this.#proposals.getApprovalReview(input);
  }

  beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalHandoff> {
    return this.#beginTransactionApprovalWithProviderCompletion(request, requestContext, options);
  }

  retryPrepare(transactionId: string): Promise<void> {
    return this.#proposals.retryPrepare(transactionId);
  }

  applyDraftEdit(input: {
    transactionId: string;
    changes: ReadonlyArray<Record<string, unknown>>;
    mode?: string;
  }): Promise<void> {
    return this.#proposals.applyDraftEdit(input);
  }

  waitForTransactionSubmission(id: string): Promise<TransactionSubmissionResolution> {
    return this.#submissionService.waitForSubmissionOutcome(id);
  }

  approveTransaction(id: string): ReturnType<TransactionController["approveTransaction"]> {
    return this.#execution.approveTransaction(id);
  }

  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    return this.#execution.rejectTransaction(id, reason);
  }

  resumePending(): Promise<void> {
    return this.#execution.resumePending();
  }

  onStatusChanged(handler: (change: TransactionStatusChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATUS_CHANGED, handler);
  }

  onStateChanged(handler: (change: TransactionStateChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATE_CHANGED, handler);
  }

  #enqueueStateChange(change: { transactionIds: string[]; approvalIds?: string[] }): void {
    for (const transactionId of change.transactionIds) {
      this.#pendingStateTransactionIds.add(transactionId);
    }
    for (const approvalId of change.approvalIds ?? []) {
      this.#pendingStateApprovalIds.add(approvalId);
    }

    if (this.#stateFlushScheduled) {
      return;
    }

    this.#stateFlushScheduled = true;
    queueMicrotask(() => {
      this.#stateFlushScheduled = false;
      this.#publishPendingStateChange();
    });
  }

  #publishPendingStateChange(): void {
    const transactionIds = [...this.#pendingStateTransactionIds];
    const approvalIds = new Set<string>(this.#pendingStateApprovalIds);
    this.#pendingStateTransactionIds.clear();
    this.#pendingStateApprovalIds.clear();

    for (const transactionId of transactionIds) {
      for (const approvalId of this.#listPendingApprovalIdsForTransaction(transactionId)) {
        approvalIds.add(approvalId);
      }
    }

    this.#messenger.publish(TRANSACTION_STATE_CHANGED, {
      transactionIds,
      approvalIds: [...approvalIds],
    });
  }

  #listPendingApprovalIdsForTransaction(transactionId: string): string[] {
    return this.#approvals.listPendingIdsBySubject({
      kind: "transaction",
      transactionId,
    });
  }

  async #beginTransactionApprovalWithProviderCompletion(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalHandoff> {
    const handoff = await this.#proposals.beginTransactionApproval(request, requestContext, options);
    const abortSignal = options.requestBinding?.signal ?? null;

    if (!abortSignal) {
      return {
        ...handoff,
        waitForProviderCompletion: () => this.waitForTransactionSubmission(handoff.transactionId),
      };
    }

    const cancelBeforeBroadcast = () => {
      void this.rejectTransaction(handoff.transactionId, createTransactionTransportDisconnectedError());
    };

    let cleanupAbortBinding = () => {};
    let isCleanedUp = false;
    let unsubscribeTerminal = () => {};
    const cleanup = () => {
      if (isCleanedUp) {
        return;
      }
      isCleanedUp = true;
      cleanupAbortBinding();
      cleanupAbortBinding = () => {};
      unsubscribeTerminal();
    };

    unsubscribeTerminal = this.onStatusChanged((change) => {
      if (change.id !== handoff.transactionId) {
        return;
      }
      if (
        (change.kind === "proposal_phase" && isProposalTerminal(change.proposal)) ||
        (change.kind === "record_status" && isTransactionRecordTerminal(change.record))
      ) {
        cleanup();
      }
    });

    if (abortSignal.aborted) {
      cancelBeforeBroadcast();
    } else {
      abortSignal.addEventListener("abort", cancelBeforeBroadcast, { once: true });
      cleanupAbortBinding = () => {
        abortSignal.removeEventListener("abort", cancelBeforeBroadcast);
      };
    }

    return {
      ...handoff,
      waitForProviderCompletion: async () => {
        try {
          return await this.waitForTransactionSubmission(handoff.transactionId);
        } finally {
          cleanup();
        }
      },
    };
  }
}
