import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { ApprovalController } from "../approval/types.js";
import type { SupportedChainsController } from "../supportedChains/types.js";
import { TransactionReviewSessions } from "./review/session.js";
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
  TransactionMeta,
  TransactionRequest,
  TransactionStateChange,
  TransactionStatusChange,
  TransactionSubmissionResolution,
  TransactionView,
} from "./types.js";
import { TransactionSubmissionError } from "./types.js";

type SubmittedTransactionMeta = TransactionMeta & {
  locator: NonNullable<TransactionMeta["locator"]>;
};

const isSubmittedTransaction = (meta: TransactionMeta): meta is SubmittedTransactionMeta =>
  (meta.status === "broadcast" || meta.status === "confirmed") && meta.locator !== null;

const isFailedTransaction = (meta: TransactionMeta) => meta.status === "failed" || meta.status === "replaced";

type TransactionSubmissionState =
  | { state: "submitted"; resolution: TransactionSubmissionResolution }
  | { state: "failed"; error: TransactionSubmissionError }
  | { state: "waiting" };

const readTransactionSubmissionState = (meta: TransactionMeta): TransactionSubmissionState => {
  if (isSubmittedTransaction(meta)) {
    const { locator } = meta;
    return { state: "submitted", resolution: { locator, meta } };
  }

  if (isFailedTransaction(meta)) {
    return { state: "failed", error: new TransactionSubmissionError(meta) };
  }

  return { state: "waiting" };
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
  approvals: Pick<ApprovalController, "create" | "onFinished">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  now?: () => number;
  tracker?: ReceiptTracker;
  /**
   * Cache size for synchronous reads (e.g. getMeta()).
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
  #proposalStore: TransactionProposalStore;
  #recordView: TransactionRecordViewStore;
  #proposals: TransactionProposalService;
  #execution: TransactionExecutionService;
  #submitted = new Map<string, TransactionSubmissionResolution>();
  #submittedLimit: number;

  constructor(options: StoreTransactionControllerOptions) {
    this.#messenger = options.messenger;
    const reviewSessions = new TransactionReviewSessions();

    const readSystemTime = options.now ?? Date.now;
    const readTransactionTimestamp = createTransactionTimestampReader(readSystemTime);
    const stateLimit = options.stateLimit ?? 200;
    this.#submittedLimit = stateLimit;
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
      reviewSessions,
      logger,
      onReviewSessionChanged: (transactionId, updatedAt) => {
        options.messenger.publish(TRANSACTION_STATE_CHANGED, {
          revision: updatedAt,
          transactionIds: [transactionId],
        });
      },
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
      reviewSessions,
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

    options.approvals.onFinished((event) => {
      const changed = this.#proposals.invalidateFromApproval(event);
      if (changed) {
        this.#messenger.publish(TRANSACTION_STATE_CHANGED, {
          revision: changed.updatedAt,
          transactionIds: [changed.transactionId],
        });
      }
    });

    this.#messenger.subscribe(TRANSACTION_STATUS_CHANGED, (change) => {
      const { id, meta } = change;
      if (change.kind === "proposal_phase" && !isProposalTerminal(change.proposal)) {
        return;
      }
      if (change.kind === "record_status" && !isTransactionRecordTerminal(change.record)) {
        return;
      }

      if (this.#proposals.deleteReviewSession(id)) {
        this.#messenger.publish(TRANSACTION_STATE_CHANGED, {
          revision: meta.updatedAt,
          transactionIds: [id],
        });
      }
    });

    this.#messenger.subscribe(TRANSACTION_SUBMITTED, ({ id, locator, meta }) => {
      this.#rememberSubmittedTransaction(id, {
        locator: structuredClone(locator),
        meta: structuredClone(meta),
      });
    });
  }

  getMeta(id: string): TransactionMeta | undefined {
    return this.#proposals.getMeta(id);
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
    return this.#proposals.beginTransactionApproval(request, requestContext, options);
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
    const submitted = this.#submitted.get(id);
    if (submitted) {
      return Promise.resolve(structuredClone(submitted));
    }

    const cached = this.getMeta(id);
    if (cached) {
      const state = readTransactionSubmissionState(cached);
      if (state.state === "submitted") return Promise.resolve(state.resolution);
      if (state.state === "failed") return Promise.reject(state.error);
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

      const completeFromMeta = (meta: TransactionMeta) => {
        const state = readTransactionSubmissionState(meta);
        if (state.state === "waiting" || !stopWaiting()) {
          return;
        }

        if (state.state === "submitted") {
          resolve(state.resolution);
          return;
        }

        reject(state.error);
      };

      const failWaiting = (error: unknown) => {
        if (stopWaiting()) {
          reject(error);
        }
      };

      const unsubscribe = this.onStatusChanged(({ id: changeId, meta }) => {
        if (changeId === id) {
          completeFromMeta(meta);
        }
      });
      const unsubscribeSubmitted = this.#messenger.subscribe(
        TRANSACTION_SUBMITTED,
        ({ id: changeId, locator, meta }) => {
          if (changeId === id) {
            if (stopWaiting()) {
              resolve({ locator: structuredClone(locator), meta: structuredClone(meta) });
            }
          }
        },
      );

      const cachedMeta = this.getMeta(id);
      const initial = cachedMeta ? Promise.resolve(cachedMeta) : this.#recordView.getOrLoad(id);

      initial.then(
        (initialMeta) => {
          if (!initialMeta) {
            failWaiting(new Error(`Transaction ${id} not found after approval`));
            return;
          }

          completeFromMeta(initialMeta);
        },
        (error) => failWaiting(error),
      );
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

  #rememberSubmittedTransaction(id: string, resolution: TransactionSubmissionResolution): void {
    this.#submitted.delete(id);
    this.#submitted.set(id, resolution);

    while (this.#submitted.size > this.#submittedLimit) {
      const oldest = this.#submitted.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#submitted.delete(oldest);
    }
  }
}
