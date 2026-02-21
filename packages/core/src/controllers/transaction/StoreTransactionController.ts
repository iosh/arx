import type { RequestContextRecord } from "../../db/records.js";
import type { TransactionsService } from "../../services/transactions/types.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { AccountController } from "../account/types.js";
import type { ApprovalController } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import { StoreTransactionView } from "./StoreTransactionView.js";
import { TransactionExecutor } from "./TransactionExecutor.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import { TRANSACTION_STATE_CHANGED_TOPIC, TRANSACTION_STATUS_CHANGED_TOPIC } from "./topics.js";
import type {
  TransactionController,
  TransactionError,
  TransactionMessenger,
  TransactionMeta,
  TransactionRequest,
  TransactionStateChange,
  TransactionStatusChange,
} from "./types.js";

export type StoreTransactionControllerOptions = {
  messenger: TransactionMessenger;
  network: Pick<NetworkController, "getActiveChain" | "getChain">;
  accounts: Pick<AccountController, "getSelectedAddress" | "getAccounts">;
  approvals: Pick<ApprovalController, "requestApproval">;
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
      network: options.network,
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

  requestTransactionApproval(
    origin: string,
    request: TransactionRequest,
    requestContext: RequestContextRecord,
    opts?: { id?: string },
  ): Promise<TransactionMeta> {
    return this.#executor.requestTransactionApproval(origin, request, requestContext, opts);
  }

  approveTransaction(id: string): Promise<TransactionMeta | null> {
    return this.#executor.approveTransaction(id);
  }

  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    return this.#executor.rejectTransaction(id, reason);
  }

  processTransaction(id: string): Promise<void> {
    return this.#executor.processTransaction(id);
  }

  resumePending(params?: { includeSigning?: boolean }): Promise<void> {
    return this.#executor.resumePending(params);
  }

  onStatusChanged(handler: (change: TransactionStatusChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATUS_CHANGED_TOPIC, handler);
  }

  onStateChanged(handler: (change: TransactionStateChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATE_CHANGED_TOPIC, handler);
  }
}
