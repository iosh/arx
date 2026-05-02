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
import {
  TRANSACTION_STATE_CHANGED,
  TRANSACTION_STATUS_CHANGED,
  TRANSACTION_SUBMITTED,
  type TransactionMessenger,
} from "./topics.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalHandoff,
  TransactionController,
  TransactionError,
  TransactionProposalView,
  TransactionRequest,
  TransactionStateChange,
  TransactionStatusChange,
  TransactionSubmissionOutcome,
  TransactionSubmissionResolution,
  TransactionView,
} from "./types.js";
import { TransactionSubmissionError } from "./types.js";

const isFailedProposalSubmission = (view: TransactionView): view is TransactionProposalView =>
  view.kind === "proposal" && view.phase === "failed";

const isUnpersistedProposalSubmission = (view: TransactionView): view is TransactionProposalView =>
  view.kind === "proposal" && view.phase === "unpersisted";

const readUnpersistedSubmissionResolution = (view: TransactionProposalView): TransactionSubmissionResolution | null => {
  const data = view.failure?.error?.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as {
    submitted?: unknown;
    locator?: unknown;
  };
  if (!candidate.submitted || !candidate.locator) {
    return null;
  }

  return {
    submitted: structuredClone(candidate.submitted) as TransactionSubmissionResolution["submitted"],
    locator: structuredClone(candidate.locator) as TransactionSubmissionResolution["locator"],
  };
};

const createTransactionTransportDisconnectedError = (): TransactionError => ({
  name: "TransportDisconnectedError",
  message: "Transport disconnected.",
  code: 4900,
});

const readTransactionSubmissionOutcome = (view: TransactionView): TransactionSubmissionOutcome | null => {
  if (view.kind === "record") {
    // Durable records only exist after broadcast succeeds. Later record transitions
    // like failed/replaced do not change the original provider completion result.
    return {
      state: "submitted",
      resolution: {
        submitted: structuredClone(view.submitted),
        locator: structuredClone(view.locator),
      },
    };
  }

  if (isFailedProposalSubmission(view)) {
    return { state: "failed", error: new TransactionSubmissionError(view) };
  }

  if (isUnpersistedProposalSubmission(view)) {
    const resolution = readUnpersistedSubmissionResolution(view);
    if (!resolution) {
      return null;
    }

    return {
      state: "submitted",
      resolution,
    };
  }

  return null;
};

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
  #proposals: TransactionProposalService;
  #execution: TransactionExecutionService;
  #submissionOutcomes = new Map<string, TransactionSubmissionOutcome>();
  #submissionOutcomeLimit: number;
  #pendingStateTransactionIds = new Set<string>();
  #pendingStateApprovalIds = new Set<string>();
  #stateFlushScheduled = false;

  constructor(options: StoreTransactionControllerOptions) {
    this.#messenger = options.messenger;
    this.#approvals = options.approvals;

    const readSystemTime = options.now ?? Date.now;
    const readTransactionTimestamp = createTransactionTimestampReader(readSystemTime);
    const stateLimit = options.stateLimit ?? 200;
    this.#submissionOutcomeLimit = stateLimit;
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

    this.#messenger.subscribe(TRANSACTION_SUBMITTED, ({ id, submitted, locator }) => {
      this.#rememberSubmissionOutcome(id, {
        state: "submitted",
        resolution: {
          submitted: structuredClone(submitted),
          locator: structuredClone(locator),
        },
      });
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
    const outcome = this.#submissionOutcomes.get(id);
    if (outcome) {
      return outcome.state === "submitted"
        ? Promise.resolve(structuredClone(outcome.resolution))
        : Promise.reject(outcome.error);
    }

    const cached = this.getView(id);
    if (cached) {
      const derived = readTransactionSubmissionOutcome(cached);
      if (derived) {
        this.#rememberSubmissionOutcome(id, derived);
        return derived.state === "submitted"
          ? Promise.resolve(structuredClone(derived.resolution))
          : Promise.reject(derived.error);
      }
    }

    return new Promise<TransactionSubmissionResolution>((resolve, reject) => {
      let isWaiting = true;

      const stopWaiting = () => {
        if (!isWaiting) return false;
        isWaiting = false;
        unsubscribe();
        unsubscribeSubmitted();
        return true;
      };

      const completeFromView = (view: TransactionView) => {
        const outcome = readTransactionSubmissionOutcome(view);
        if (!outcome || !stopWaiting()) {
          return;
        }

        this.#rememberSubmissionOutcome(id, outcome);
        if (outcome.state === "submitted") {
          resolve(structuredClone(outcome.resolution));
          return;
        }

        reject(outcome.error);
      };

      const unsubscribe = this.onStatusChanged((change) => {
        const view = change.kind === "proposal_phase" ? change.proposal : change.record;
        const changeId = view.id;
        if (changeId === id) {
          completeFromView(view);
        }
      });
      const unsubscribeSubmitted = this.#messenger.subscribe(
        TRANSACTION_SUBMITTED,
        ({ id: changeId, submitted, locator }) => {
          if (changeId === id) {
            if (stopWaiting()) {
              resolve({ submitted: structuredClone(submitted), locator: structuredClone(locator) });
            }
          }
        },
      );
      const outcomeAfterSubscribe = this.#submissionOutcomes.get(id);
      if (outcomeAfterSubscribe) {
        if (stopWaiting()) {
          if (outcomeAfterSubscribe.state === "submitted") {
            resolve(structuredClone(outcomeAfterSubscribe.resolution));
          } else {
            reject(outcomeAfterSubscribe.error);
          }
        }
        return;
      }

      const initialView = this.getView(id);
      if (initialView) {
        completeFromView(initialView);
        if (!isWaiting) {
          return;
        }
      } else {
        void this.#recordView.getOrLoadView(id).then(
          (loadedView) => {
            if (!isWaiting) {
              return;
            }
            if (!loadedView) {
              if (stopWaiting()) {
                reject(new Error(`Transaction ${id} not found after approval`));
              }
              return;
            }
            completeFromView(loadedView);
          },
          (error) => {
            if (stopWaiting()) {
              reject(error);
            }
          },
        );
      }
    });
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

  #rememberSubmissionOutcome(id: string, outcome: TransactionSubmissionOutcome): void {
    this.#submissionOutcomes.delete(id);
    this.#submissionOutcomes.set(id, structuredClone(outcome));

    while (this.#submissionOutcomes.size > this.#submissionOutcomeLimit) {
      const oldest = this.#submissionOutcomes.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#submissionOutcomes.delete(oldest);
    }
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
