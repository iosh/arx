import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { ApprovalController } from "../approval/types.js";
import type { SupportedChainsController } from "../supportedChains/types.js";
import { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import { TransactionReviewSessions } from "./review/session.js";
import { StoreTransactionView } from "./StoreTransactionView.js";
import { isTerminalTransactionStatus } from "./status.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionProposalService } from "./TransactionProposalService.js";
import { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import { TRANSACTION_STATE_CHANGED, TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalHandoff,
  TransactionController,
  TransactionError,
  TransactionMeta,
  TransactionRequest,
  TransactionStateChange,
  TransactionStatus,
  TransactionStatusChange,
  TransactionSubmissionResolution,
} from "./types.js";
import { TransactionSubmissionError } from "./types.js";

const SUBMITTED_TRANSACTION_STATUSES = new Set<TransactionStatus>(["broadcast", "confirmed"]);
const FAILED_TRANSACTION_STATUSES = new Set<TransactionStatus>(["failed", "replaced"]);

type SubmittedTransactionMeta = TransactionMeta & {
  locator: NonNullable<TransactionMeta["locator"]>;
};

const isSubmittedTransaction = (meta: TransactionMeta): meta is SubmittedTransactionMeta =>
  SUBMITTED_TRANSACTION_STATUSES.has(meta.status) && meta.locator !== null;

const isFailedTransaction = (meta: TransactionMeta) => FAILED_TRANSACTION_STATUSES.has(meta.status);

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
  #runtime: RuntimeTransactionStore;
  #view: StoreTransactionView;
  #proposals: TransactionProposalService;
  #execution: TransactionExecutionService;

  constructor(options: StoreTransactionControllerOptions) {
    this.#messenger = options.messenger;
    const reviewSessions = new TransactionReviewSessions();

    const readSystemTime = options.now ?? Date.now;
    const readTransactionTimestamp = createTransactionTimestampReader(readSystemTime);
    const stateLimit = options.stateLimit ?? 200;
    const logger = options.logger ?? (() => {});

    this.#runtime = new RuntimeTransactionStore({
      messenger: options.messenger,
      accountCodecs: options.accountCodecs,
    });

    this.#view = new StoreTransactionView({
      messenger: options.messenger,
      service: options.service,
      accountCodecs: options.accountCodecs,
      stateLimit,
      logger,
    });

    const tracking = new TransactionReceiptTracking({
      view: this.#view,
      namespaces: options.namespaces,
      service: options.service,
      ...(options.tracker ? { tracker: options.tracker } : {}),
    });

    const prepare = new TransactionPrepareManager({
      runtime: this.#runtime,
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
      runtime: this.#runtime,
      view: this.#view,
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
      runtime: this.#runtime,
      view: this.#view,
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

    this.#messenger.subscribe(TRANSACTION_STATUS_CHANGED, ({ id, meta }) => {
      if (!isTerminalTransactionStatus(meta.status)) {
        return;
      }

      if (this.#proposals.deleteReviewSession(id)) {
        this.#messenger.publish(TRANSACTION_STATE_CHANGED, {
          revision: meta.updatedAt,
          transactionIds: [id],
        });
      }
    });
  }

  getMeta(id: string): TransactionMeta | undefined {
    return this.#proposals.getMeta(id);
  }

  getReviewSession(transactionId: string) {
    return this.#proposals.getReviewSession(transactionId);
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

  async waitForTransactionSubmission(id: string): Promise<TransactionSubmissionResolution> {
    const initial = this.getMeta(id) ?? (await this.#view.getOrLoad(id));
    if (!initial) {
      throw new Error(`Transaction ${id} not found after approval`);
    }

    if (isSubmittedTransaction(initial)) {
      const { locator } = initial;
      return { locator, meta: initial };
    }
    if (isFailedTransaction(initial)) {
      throw new TransactionSubmissionError(initial);
    }

    return await new Promise<TransactionSubmissionResolution>((resolve, reject) => {
      const unsubscribe = this.onStatusChanged(({ id: changeId, meta }) => {
        if (changeId !== id) {
          return;
        }

        if (isSubmittedTransaction(meta)) {
          unsubscribe();
          const { locator } = meta;
          resolve({ locator, meta });
          return;
        }

        if (isFailedTransaction(meta)) {
          unsubscribe();
          reject(new TransactionSubmissionError(meta));
        }
      });
    });
  }

  approveTransaction(id: string): ReturnType<TransactionController["approveTransaction"]> {
    return this.#execution.approveTransaction(id);
  }

  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    return this.#execution.rejectTransaction(id, reason);
  }

  processTransaction(id: string): Promise<void> {
    return this.#execution.processTransaction(id);
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
}
