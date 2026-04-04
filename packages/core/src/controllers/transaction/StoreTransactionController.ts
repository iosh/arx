import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkPreferencesService } from "../../services/store/networkPreferences/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { ApprovalController } from "../approval/types.js";
import type { ChainDefinitionsController } from "../chainDefinitions/types.js";
import { StoreTransactionView } from "./StoreTransactionView.js";
import { TransactionExecutor } from "./TransactionExecutor.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import { TRANSACTION_STATE_CHANGED, TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  ResumePendingTransactionsOptions,
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

type SubmittedTransactionMeta = TransactionMeta & { hash: string };

const isSubmittedTransaction = (meta: TransactionMeta): meta is SubmittedTransactionMeta =>
  SUBMITTED_TRANSACTION_STATUSES.has(meta.status) && typeof meta.hash === "string";

const isFailedTransaction = (meta: TransactionMeta) => FAILED_TRANSACTION_STATUSES.has(meta.status);

export type StoreTransactionControllerOptions = {
  messenger: TransactionMessenger;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress" | "toCanonicalAddressFromAccountKey">;
  networkPreferences: Pick<NetworkPreferencesService, "getActiveChainRef">;
  chainDefinitions: Pick<ChainDefinitionsController, "getChain">;
  accounts: Pick<AccountController, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create">;
  registry: TransactionAdapterRegistry;
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
 * Persistent transactions controller:
 * - Single source of truth: TransactionsService (backed by the `transactions` table)
 * - Read model: StoreTransactionView (bounded LRU + best-effort sync)
 * - Execution: TransactionExecutor (queue + signing/broadcast + receipt tracking)
 */
export class StoreTransactionController implements TransactionController {
  #messenger: TransactionMessenger;
  #view: StoreTransactionView;
  #executor: TransactionExecutor;

  constructor(options: StoreTransactionControllerOptions) {
    this.#messenger = options.messenger;

    const now = options.now ?? Date.now;
    const stateLimit = options.stateLimit ?? 200;
    const logger = options.logger ?? (() => {});

    this.#view = new StoreTransactionView({
      messenger: options.messenger,
      service: options.service,
      accountCodecs: options.accountCodecs,
      stateLimit,
      logger,
    });

    const tracking = new TransactionReceiptTracking({
      view: this.#view,
      registry: options.registry,
      service: options.service,
      ...(options.tracker ? { tracker: options.tracker } : {}),
    });

    const prepare = new TransactionPrepareManager({
      view: this.#view,
      registry: options.registry,
      service: options.service,
      logger,
    });

    this.#executor = new TransactionExecutor({
      view: this.#view,
      accountCodecs: options.accountCodecs,
      networkPreferences: options.networkPreferences,
      chainDefinitions: options.chainDefinitions,
      accounts: options.accounts,
      approvals: options.approvals,
      registry: options.registry,
      service: options.service,
      prepare,
      tracking,
      now,
    });
  }

  getMeta(id: string): TransactionMeta | undefined {
    return this.#view.getMeta(id);
  }

  beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
  ): Promise<TransactionApprovalHandoff> {
    return this.#executor.beginTransactionApproval(request, requestContext);
  }

  async waitForTransactionSubmission(id: string): Promise<TransactionSubmissionResolution> {
    const initial = this.getMeta(id) ?? (await this.#view.getOrLoad(id));
    if (!initial) {
      throw new Error(`Transaction ${id} not found after approval`);
    }

    if (isSubmittedTransaction(initial)) {
      const { hash } = initial;
      return { hash, meta: initial };
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
          const { hash } = meta;
          resolve({ hash, meta });
          return;
        }

        if (isFailedTransaction(meta)) {
          unsubscribe();
          reject(new TransactionSubmissionError(meta));
        }
      });
    });
  }

  approveTransaction(id: string): Promise<TransactionMeta | null> {
    return this.#executor.approveTransaction(id);
  }

  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    return this.#executor.rejectTransaction(id, reason);
  }

  processTransaction(id: string): Promise<void> {
    this.#executor.markRetainedExecutionResumed(id);
    return this.#executor.processTransaction(id);
  }

  resumePending(params?: ResumePendingTransactionsOptions): Promise<void> {
    return this.#executor.resumePending(params);
  }

  onStatusChanged(handler: (change: TransactionStatusChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATUS_CHANGED, handler);
  }

  onStateChanged(handler: (change: TransactionStateChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATE_CHANGED, handler);
  }
}
