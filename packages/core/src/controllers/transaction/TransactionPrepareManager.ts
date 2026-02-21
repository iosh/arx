import type { TransactionsService } from "../../services/transactions/types.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isPrepareEligibleTransactionStatus } from "./status.js";
import type { TransactionIssue, TransactionMeta, TransactionWarning } from "./types.js";
import {
  buildAdapterContext,
  cloneIssues,
  cloneWarnings,
  issueFromPrepareError,
  mergeIssues,
  mergeWarnings,
  missingAdapterIssue,
} from "./utils.js";

const DEFAULT_PREPARE_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;

type Options = {
  view: StoreTransactionView;
  registry: TransactionAdapterRegistry;
  service: TransactionsService;
  logger?: (message: string, data?: unknown) => void;
  prepareTimeoutMs?: number;
  backgroundConcurrency?: number;
};

export class TransactionPrepareManager {
  #view: StoreTransactionView;
  #registry: TransactionAdapterRegistry;
  #service: TransactionsService;
  #logger: (message: string, data?: unknown) => void;
  #timeoutMs: number;

  #prepareInFlight: Map<string, Promise<void>> = new Map();

  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor(options: Options) {
    this.#view = options.view;
    this.#registry = options.registry;
    this.#service = options.service;
    this.#logger = options.logger ?? (() => {});
    this.#timeoutMs = options.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
    this.#prepareConcurrencyLimit = Math.max(
      1,
      options.backgroundConcurrency ?? DEFAULT_BACKGROUND_PREPARE_CONCURRENCY,
    );
  }

  async #commitLatest(id: string, fallback: TransactionMeta): Promise<TransactionMeta> {
    const latest = await this.#service.get(id);
    if (!latest) return fallback;
    return this.#view.commitRecord(latest).next;
  }

  async #patchAndCommit(
    id: string,
    patch: Parameters<TransactionsService["patch"]>[0]["patch"],
    fallback: TransactionMeta,
  ): Promise<TransactionMeta> {
    const patched = await this.#service.patch({ id, patch });
    if (!patched) {
      return await this.#commitLatest(id, fallback);
    }
    return this.#view.commitRecord(patched).next;
  }

  queuePrepare(id: string) {
    void this.ensurePrepared(id, { source: "background" }).catch((error) => {
      // Best-effort background preparation; failures are surfaced via issues on the transaction record.
      this.#logger("transactions: prepare failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async ensurePrepared(
    id: string,
    opts?: { timeoutMs?: number; source?: "background" | "execution" },
  ): Promise<TransactionMeta | null> {
    const existing = this.#prepareInFlight.get(id);
    if (existing) {
      await existing;
      return await this.#view.getOrLoad(id);
    }

    const run = this.#prepareAndPersistInternal(id, opts);
    const tracked = run
      .then(() => undefined)
      .finally(() => {
        this.#prepareInFlight.delete(id);
      });

    this.#prepareInFlight.set(id, tracked);
    return run;
  }

  async #prepareAndPersistInternal(
    id: string,
    opts?: { timeoutMs?: number; source?: "background" | "execution" },
  ): Promise<TransactionMeta | null> {
    const timeoutMs = opts?.timeoutMs ?? this.#timeoutMs;

    let meta = this.#view.getMeta(id);
    if (!meta) {
      const record = await this.#service.get(id);
      if (!record) return null;
      meta = this.#view.commitRecord(record).next;
    }

    if (meta.prepared) {
      return meta;
    }

    // No need to prepare once a tx is no longer eligible for enrichment.
    if (!isPrepareEligibleTransactionStatus(meta.status)) {
      return meta;
    }

    const adapter = this.#registry.get(meta.namespace);
    if (!adapter) {
      return await this.#patchAndCommit(
        id,
        {
          prepared: null,
          warnings: cloneWarnings(meta.warnings),
          issues: cloneIssues([...meta.issues, missingAdapterIssue(meta.namespace)]),
        },
        meta,
      );
    }

    try {
      const context = buildAdapterContext(meta);
      const runPrepare = async () => await this.#withTimeout(adapter.prepareTransaction(context), timeoutMs);
      const result = opts?.source === "background" ? await this.#withPrepareSlot(runPrepare) : await runPrepare();

      const nextWarnings: TransactionWarning[] = mergeWarnings(meta.warnings, result.warnings);
      const nextIssues: TransactionIssue[] = mergeIssues(meta.issues, result.issues);

      return await this.#patchAndCommit(
        id,
        {
          prepared: result.prepared,
          warnings: cloneWarnings(nextWarnings),
          issues: cloneIssues(nextIssues),
        },
        meta,
      );
    } catch (error) {
      const issue = issueFromPrepareError(error);
      return await this.#patchAndCommit(
        id,
        {
          prepared: null,
          warnings: cloneWarnings(meta.warnings),
          issues: cloneIssues(mergeIssues(meta.issues, [issue])),
        },
        meta,
      );
    }
  }

  async #withPrepareSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#prepareConcurrencyInUse >= this.#prepareConcurrencyLimit) {
      // Wait for a slot to be handed off by a releasing task.
      await new Promise<void>((resolve) => {
        this.#prepareConcurrencyWaiters.push(resolve);
      });
    } else {
      this.#prepareConcurrencyInUse += 1;
    }
    try {
      return await fn();
    } finally {
      const waiter = this.#prepareConcurrencyWaiters.shift();
      if (waiter) {
        // Hand off the slot directly to the next waiter (keep inUse unchanged).
        waiter();
      } else {
        this.#prepareConcurrencyInUse = Math.max(0, this.#prepareConcurrencyInUse - 1);
      }
    }
  }

  async #withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      // Simple timeout guard for slow/unresponsive RPC nodes.
      timer = setTimeout(() => {
        const error = new Error("Transaction preparation timed out.");
        error.name = "TransactionPrepareTimeoutError";
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
