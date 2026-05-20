import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "../../controllers/transaction/topics.js";
import type {
  TransactionRecordReader,
  TransactionRecordStatusChange,
  TransactionRecordView,
} from "../../controllers/transaction/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import type { TransactionReceipt } from "../../transactions/types.js";

type Options = {
  messenger: TransactionMessenger;
  service: TransactionsService;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  stateLimit: number;
  logger?: (message: string, data?: unknown) => void;
};

/**
 * Store-backed record read model:
 * - bounded LRU cache for synchronous reads (getView())
 * - coalesced best-effort sync on store change
 * - emits transaction:statusChanged
 */
export class TransactionRecordViewStore implements TransactionRecordReader {
  #messenger: TransactionMessenger;
  #service: TransactionsService;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #stateLimit: number;
  #logger: (message: string, data?: unknown) => void;

  #records: Map<string, TransactionRecordView> = new Map();
  #changeListeners = new Set<(transactionIds: string[]) => void>();

  #syncWanted = false;
  #syncInFlight: Promise<void> | null = null;

  constructor({ messenger, service, accountCodecs, stateLimit, logger }: Options) {
    this.#messenger = messenger;
    this.#service = service;
    this.#accountCodecs = accountCodecs;
    this.#stateLimit = stateLimit;
    this.#logger = logger ?? (() => {});

    this.#service.subscribeChanged(() => this.requestSync());

    // Best-effort initial sync so RPC/UI can see store-backed transactions quickly after cold starts.
    this.requestSync();
  }

  getView(id: string): TransactionRecordView | undefined {
    const existing = this.#touch(id);
    return existing ? structuredClone(existing) : undefined;
  }

  getRecordView(id: string): TransactionRecordView | undefined {
    return this.getView(id);
  }

  /**
   * Record view access for orchestrators (do not mutate).
   * Does not touch LRU ordering.
   */
  peekView(id: string): TransactionRecordView | undefined {
    return this.#records.get(id);
  }

  async getOrLoadView(id: string): Promise<TransactionRecordView | null> {
    const cached = this.peekView(id);
    if (cached) return structuredClone(cached);

    const record = await this.#service.get(id);
    if (!record) return null;

    const view = this.#buildRecordView(record);
    // Specific reads warm the cache but do not synthesize lifecycle events.
    this.#upsert(view);
    return structuredClone(view);
  }

  async getOrLoadRecordView(id: string): Promise<TransactionRecordView | null> {
    return await this.getOrLoadView(id);
  }

  /**
   * Authoritative commit: updates cache and emits status change when status differs.
   */
  commitRecordView(record: TransactionRecord): { previous?: TransactionRecordView; next: TransactionRecordView } {
    const next = this.#buildRecordView(record);
    const previous = this.commitView(next);
    return previous ? { previous, next } : { next };
  }

  commitView(next: TransactionRecordView): TransactionRecordView | undefined {
    const previous = this.peekView(next.id);
    this.#upsert(next);

    if (!previous || previous.status !== next.status) {
      const payload: TransactionRecordStatusChange = {
        kind: "record_status",
        id: next.id,
        previousStatus: previous?.status ?? null,
        nextStatus: next.status,
        record: structuredClone(next),
      };
      this.#messenger.publish(TRANSACTION_STATUS_CHANGED, payload);
    }

    return previous ? structuredClone(previous) : undefined;
  }

  /**
   * Store ingestion: updates cache without emitting status change events.
   * Intended for best-effort sync and cold-start cache warmup.
   */
  ingestRecords(records: TransactionRecord[]): void {
    // Insert oldest -> newest so LRU eviction keeps the most recent entries.
    for (const record of [...records].reverse()) {
      const view = this.#buildRecordView(record);
      this.#upsert(view);
    }
  }

  requestSync(): void {
    this.#syncWanted = true;
    if (this.#syncInFlight) return;

    this.#syncInFlight = (async () => {
      while (this.#syncWanted) {
        this.#syncWanted = false;
        try {
          await this.syncRecent();
        } catch (error) {
          // Best-effort: record view sync should never destabilize the worker.
          this.#logger("transactions:record-view sync failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })().finally(() => {
      this.#syncInFlight = null;
    });
  }

  async syncRecent(): Promise<void> {
    const recent = await this.#service.list({ limit: this.#stateLimit * 2 });
    this.ingestRecords(recent);
  }

  notifyStateChanged(transactionIds: string[]): void {
    this.#notifyChanged(transactionIds);
  }

  #upsert(view: TransactionRecordView) {
    // Maintain a bounded LRU cache for synchronous reads (e.g. getView()).
    this.#records.delete(view.id);
    this.#records.set(view.id, structuredClone(view));

    while (this.#records.size > this.#stateLimit) {
      const oldest = this.#records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#records.delete(oldest);
    }

    this.#notifyChanged([view.id]);
  }

  #touch(id: string): TransactionRecordView | undefined {
    const existing = this.#records.get(id);
    if (!existing) return undefined;
    this.#records.delete(id);
    this.#records.set(id, existing);
    return existing;
  }

  onChanged(handler: (transactionIds: string[]) => void): () => void {
    this.#changeListeners.add(handler);
    return () => {
      this.#changeListeners.delete(handler);
    };
  }

  #notifyChanged(transactionIds: string[]) {
    for (const handler of this.#changeListeners) {
      handler(transactionIds);
    }
  }

  #deriveAccountAddress(record: TransactionRecord): string {
    try {
      return this.#accountCodecs.toCanonicalAddressFromAccountKey({ accountKey: record.accountKey });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Transaction record ${record.id} has an invalid accountKey ${record.accountKey}: ${message}`, {
        cause: error,
      });
    }
  }

  #buildRecordView(record: TransactionRecord): TransactionRecordView {
    return {
      kind: "record",
      id: record.id,
      namespace: record.namespace,
      chainRef: record.chainRef,
      origin: record.origin,
      accountAddress: this.#deriveAccountAddress(record),
      accountKey: record.accountKey,
      status: record.status,
      submitted: structuredClone(record.submitted),
      receipt: structuredClone((record.receipt ?? null) as TransactionReceipt | null),
      replacementKey: structuredClone(record.replacementKey),
      replacedByRecordId: record.replacedByRecordId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
