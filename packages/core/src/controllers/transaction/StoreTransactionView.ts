import { toCanonicalAddressFromAccountId } from "../../accounts/accountId.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import { TRANSACTION_STATE_CHANGED, TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionIssue,
  TransactionMeta,
  TransactionPrepared,
  TransactionReceipt,
  TransactionStateChange,
  TransactionStatusChange,
  TransactionWarning,
} from "./types.js";
import { cloneMeta, cloneRequest } from "./utils.js";

type Options = {
  messenger: TransactionMessenger;
  service: TransactionsService;
  stateLimit: number;
  logger?: (message: string, data?: unknown) => void;
};

/**
 * Store-backed read model:
 * - bounded LRU cache for synchronous reads (getMeta())
 * - coalesced best-effort sync on store change
 * - emits transaction:statusChanged and transaction:stateChanged
 */
export class StoreTransactionView {
  #messenger: TransactionMessenger;
  #service: TransactionsService;
  #stateLimit: number;
  #logger: (message: string, data?: unknown) => void;
  #unsubscribeStore: (() => void) | null = null;
  #fromDecodeLogged: Set<string> = new Set();

  #records: Map<string, TransactionMeta> = new Map();

  #stateRevision = 0;
  #statePublishScheduled = false;

  #syncWanted = false;
  #syncInFlight: Promise<void> | null = null;

  constructor({ messenger, service, stateLimit, logger }: Options) {
    this.#messenger = messenger;
    this.#service = service;
    this.#stateLimit = stateLimit;
    this.#logger = logger ?? (() => {});

    this.#unsubscribeStore = this.#service.subscribeChanged(() => this.requestSync());

    // Best-effort initial sync so RPC/UI can see store-backed transactions quickly after cold starts.
    this.requestSync();
  }

  destroy() {
    if (!this.#unsubscribeStore) return;
    try {
      this.#unsubscribeStore();
    } catch (error) {
      this.#logger("transactions:view failed to remove store listener", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#unsubscribeStore = null;
    }
  }

  getMeta(id: string): TransactionMeta | undefined {
    const existing = this.#touch(id);
    return existing ? cloneMeta(existing) : undefined;
  }

  /**
   * Internal access for orchestrators (do not mutate).
   * Does not touch LRU ordering.
   */
  peek(id: string): TransactionMeta | undefined {
    return this.#records.get(id);
  }

  async getOrLoad(id: string): Promise<TransactionMeta | null> {
    const cached = this.peek(id);
    if (cached) return cloneMeta(cached);

    const record = await this.#service.get(id);
    if (!record) return null;

    const meta = this.#toTransactionMeta(record);
    // Loading a specific id is an authoritative read (do emit status events if changed).
    this.commitMeta(meta);
    return cloneMeta(meta);
  }

  /**
   * Authoritative commit: updates cache and emits status change when status differs.
   */
  commitRecord(record: TransactionRecord): { previous?: TransactionMeta; next: TransactionMeta } {
    const next = this.#toTransactionMeta(record);
    const previous = this.commitMeta(next);
    return previous ? { previous, next } : { next };
  }

  commitMeta(next: TransactionMeta): TransactionMeta | undefined {
    const previous = this.peek(next.id);
    this.#upsert(next);

    if (previous && previous.status !== next.status) {
      const payload: TransactionStatusChange = {
        id: next.id,
        previousStatus: previous.status,
        nextStatus: next.status,
        meta: cloneMeta(next),
      };
      this.#messenger.publish(TRANSACTION_STATUS_CHANGED, payload);
    }

    return previous ? cloneMeta(previous) : undefined;
  }

  /**
   * Store ingestion: updates cache without emitting status change events.
   * Intended for best-effort sync and cold-start cache warmup.
   */
  ingestRecords(records: TransactionRecord[]): void {
    // Insert oldest -> newest so LRU eviction keeps the most recent entries.
    for (const record of [...records].reverse()) {
      const meta = this.#toTransactionMeta(record);
      this.#upsert(meta);
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
          // Best-effort: view sync should never destabilize the worker.
          this.#logger("transactions:view sync failed", {
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

  #upsert(meta: TransactionMeta) {
    // Maintain a bounded LRU cache for synchronous reads (e.g. getMeta()).
    this.#records.delete(meta.id);
    this.#records.set(meta.id, cloneMeta(meta));

    while (this.#records.size > this.#stateLimit) {
      const oldest = this.#records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#records.delete(oldest);
      this.#fromDecodeLogged.delete(oldest);
    }

    this.#scheduleStateChanged();
  }

  #touch(id: string): TransactionMeta | undefined {
    const existing = this.#records.get(id);
    if (!existing) return undefined;
    this.#records.delete(id);
    this.#records.set(id, existing);
    return existing;
  }

  #scheduleStateChanged() {
    if (this.#statePublishScheduled) return;
    this.#statePublishScheduled = true;

    queueMicrotask(() => {
      this.#statePublishScheduled = false;
      this.#stateRevision += 1;
      const payload: TransactionStateChange = { revision: this.#stateRevision };
      this.#messenger.publish(TRANSACTION_STATE_CHANGED, payload);
    });
  }

  #safeFromAccountIdToAddress(record: TransactionRecord): string | null {
    try {
      return toCanonicalAddressFromAccountId({ chainRef: record.chainRef, accountId: record.fromAccountId });
    } catch (error) {
      if (!this.#fromDecodeLogged.has(record.id)) {
        this.#fromDecodeLogged.add(record.id);
        this.#logger("transactions:view failed to derive from address", {
          id: record.id,
          chainRef: record.chainRef,
          fromAccountId: record.fromAccountId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  #mapWarnings(list: TransactionRecord["warnings"]): TransactionWarning[] {
    return list.map((item) => ({
      kind: "warning" as const,
      code: item.code,
      message: item.message,
      ...(item.severity !== undefined ? { severity: item.severity } : {}),
      ...(item.data !== undefined ? { data: item.data } : {}),
    }));
  }

  #mapIssues(list: TransactionRecord["issues"]): TransactionIssue[] {
    return list.map((item) => ({
      kind: "issue" as const,
      code: item.code,
      message: item.message,
      ...(item.severity !== undefined ? { severity: item.severity } : {}),
      ...(item.data !== undefined ? { data: item.data } : {}),
    }));
  }

  #toTransactionMeta(record: TransactionRecord): TransactionMeta {
    return {
      id: record.id,
      namespace: record.namespace,
      chainRef: record.chainRef,
      origin: record.origin,
      from: this.#safeFromAccountIdToAddress(record),
      request: cloneRequest(record.request),
      prepared: (record.prepared ?? null) as TransactionPrepared | null,
      status: record.status,
      hash: record.hash,
      receipt: (record.receipt ?? null) as TransactionReceipt | null,
      error: record.error ?? null,
      userRejected: record.userRejected,
      warnings: this.#mapWarnings(record.warnings),
      issues: this.#mapIssues(record.issues),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
