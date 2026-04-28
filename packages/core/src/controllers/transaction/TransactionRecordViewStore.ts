import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { getChainRefNamespace } from "../../chains/caip.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import { TRANSACTION_STATE_CHANGED, TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionMeta,
  TransactionReceipt,
  TransactionRecordView,
  TransactionStateChange,
  TransactionStatusChange,
} from "./types.js";

type Options = {
  messenger: TransactionMessenger;
  service: TransactionsService;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  stateLimit: number;
  logger?: (message: string, data?: unknown) => void;
};

/**
 * Durable record-backed read model:
 * - bounded LRU cache for synchronous reads (getMeta())
 * - coalesced best-effort sync on store change
 * - emits transaction:statusChanged and transaction:stateChanged
 */
export class TransactionRecordViewStore {
  #messenger: TransactionMessenger;
  #service: TransactionsService;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #stateLimit: number;
  #logger: (message: string, data?: unknown) => void;
  #fromDecodeLogged: Set<string> = new Set();

  #records: Map<string, TransactionRecordView> = new Map();

  #stateRevision = 0;
  #statePublishScheduled = false;
  #pendingStateChangeIds: Set<string> = new Set();

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

  getMeta(id: string): TransactionMeta | undefined {
    const existing = this.#touch(id);
    return existing ? this.#buildMetaFromRecordView(existing) : undefined;
  }

  getView(id: string): TransactionRecordView | undefined {
    const existing = this.#touch(id);
    return existing ? structuredClone(existing) : undefined;
  }

  /**
   * Internal access for orchestrators (do not mutate).
   * Does not touch LRU ordering.
   */
  peek(id: string): TransactionMeta | undefined {
    const existing = this.#records.get(id);
    return existing ? this.#buildMetaFromRecordView(existing) : undefined;
  }

  peekView(id: string): TransactionRecordView | undefined {
    return this.#records.get(id);
  }

  async getOrLoad(id: string): Promise<TransactionMeta | null> {
    const view = await this.getOrLoadView(id);
    return view ? this.#buildMetaFromRecordView(view) : null;
  }

  async getOrLoadView(id: string): Promise<TransactionRecordView | null> {
    const cached = this.peekView(id);
    if (cached) return structuredClone(cached);

    const record = await this.#service.get(id);
    if (!record) return null;

    const view = this.#buildRecordView(record);
    // Loading a specific id is an authoritative read (do emit status events if changed).
    this.commitView(view);
    return structuredClone(view);
  }

  /**
   * Authoritative commit: updates cache and emits status change when status differs.
   */
  commitRecord(record: TransactionRecord): { previous?: TransactionMeta; next: TransactionMeta } {
    const committed = this.commitRecordView(record);
    const next = this.#buildMetaFromRecordView(committed.next);
    return committed.previous ? { previous: this.#buildMetaFromRecordView(committed.previous), next } : { next };
  }

  commitRecordView(record: TransactionRecord): { previous?: TransactionRecordView; next: TransactionRecordView } {
    const next = this.#buildRecordView(record);
    const previous = this.commitView(next);
    return previous ? { previous, next } : { next };
  }

  commitView(next: TransactionRecordView): TransactionRecordView | undefined {
    const previous = this.peekView(next.id);
    this.#upsert(next);

    if (previous && previous.status !== next.status) {
      const payload: TransactionStatusChange = {
        id: next.id,
        previousStatus: previous.status,
        nextStatus: next.status,
        meta: this.#buildMetaFromRecordView(next),
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
    for (const id of transactionIds) {
      this.#scheduleStateChanged(id);
    }
  }

  #upsert(view: TransactionRecordView) {
    // Maintain a bounded LRU cache for synchronous reads (e.g. getMeta()).
    this.#records.delete(view.id);
    this.#records.set(view.id, structuredClone(view));

    while (this.#records.size > this.#stateLimit) {
      const oldest = this.#records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#records.delete(oldest);
      this.#fromDecodeLogged.delete(oldest);
    }

    this.#scheduleStateChanged(view.id);
  }

  #touch(id: string): TransactionRecordView | undefined {
    const existing = this.#records.get(id);
    if (!existing) return undefined;
    this.#records.delete(id);
    this.#records.set(id, existing);
    return existing;
  }

  #scheduleStateChanged(id: string) {
    this.#pendingStateChangeIds.add(id);
    if (this.#statePublishScheduled) return;
    this.#statePublishScheduled = true;

    queueMicrotask(() => {
      this.#statePublishScheduled = false;
      this.#stateRevision += 1;
      const transactionIds = [...this.#pendingStateChangeIds];
      this.#pendingStateChangeIds.clear();
      const payload: TransactionStateChange = { revision: this.#stateRevision, transactionIds };
      this.#messenger.publish(TRANSACTION_STATE_CHANGED, payload);
    });
  }

  #safeFromAccountKeyToAddress(record: TransactionRecord): string | null {
    try {
      return this.#accountCodecs.toCanonicalAddressFromAccountKey({ accountKey: record.fromAccountKey });
    } catch (error) {
      if (!this.#fromDecodeLogged.has(record.id)) {
        this.#fromDecodeLogged.add(record.id);
        this.#logger("transactions:record-view failed to derive from address", {
          id: record.id,
          chainRef: record.chainRef,
          fromAccountKey: record.fromAccountKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  #buildRecordView(record: TransactionRecord): TransactionRecordView {
    return {
      kind: "record",
      id: record.id,
      namespace: getChainRefNamespace(record.chainRef),
      chainRef: record.chainRef,
      origin: record.origin,
      from: this.#safeFromAccountKeyToAddress(record),
      status: record.status,
      submitted: structuredClone(record.submitted),
      locator: structuredClone(record.locator),
      receipt: structuredClone((record.receipt ?? null) as TransactionReceipt | null),
      replacedId: record.replacedId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  #buildMetaFromRecordView(view: TransactionRecordView): TransactionMeta {
    return {
      id: view.id,
      namespace: view.namespace,
      chainRef: view.chainRef,
      origin: view.origin,
      from: view.from,
      request: null,
      prepared: null,
      status: view.status,
      submitted: structuredClone(view.submitted),
      locator: structuredClone(view.locator),
      receipt: structuredClone(view.receipt),
      replacedId: view.replacedId,
      error: null,
      userRejected: false,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    };
  }
}
