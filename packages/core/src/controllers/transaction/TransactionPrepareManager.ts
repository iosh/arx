import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import type { TransactionReviewSessions } from "./review/session.js";
import type { TransactionReviewMessage } from "./review/types.js";
import { isPrepareEligibleTransactionStatus } from "./status.js";
import type { TransactionMeta } from "./types.js";
import { buildPrepareContext } from "./utils.js";

const DEFAULT_PREPARE_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;

type Options = {
  runtime: RuntimeTransactionStore;
  registry: TransactionAdapterRegistry;
  reviewSessions: TransactionReviewSessions;
  logger?: (message: string, data?: unknown) => void;
  prepareTimeoutMs?: number;
  backgroundConcurrency?: number;
};

export class TransactionPrepareManager {
  #runtime: RuntimeTransactionStore;
  #registry: TransactionAdapterRegistry;
  #reviewSessions: TransactionReviewSessions;
  #logger: (message: string, data?: unknown) => void;
  #timeoutMs: number;

  #prepareInFlight: Map<string, Promise<void>> = new Map();

  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor(options: Options) {
    this.#runtime = options.runtime;
    this.#registry = options.registry;
    this.#reviewSessions = options.reviewSessions;
    this.#logger = options.logger ?? (() => {});
    this.#timeoutMs = options.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
    this.#prepareConcurrencyLimit = Math.max(
      1,
      options.backgroundConcurrency ?? DEFAULT_BACKGROUND_PREPARE_CONCURRENCY,
    );
  }

  #patchAndCommit(
    id: string,
    patch: Parameters<RuntimeTransactionStore["patch"]>[1],
    fallback: TransactionMeta,
  ): TransactionMeta {
    return this.#runtime.patch(id, patch) ?? fallback;
  }

  #toReviewMessage(input: { code: string; message: string; data?: unknown }): TransactionReviewMessage {
    return {
      code: input.code,
      message: input.message,
      ...(input.data && typeof input.data === "object" ? { details: input.data as Record<string, unknown> } : {}),
    };
  }

  #classifyPreparedDiagnostics(result: {
    warnings: Array<{ code: string; message: string; data?: unknown }>;
    issues: Array<{ code: string; message: string; data?: unknown }>;
  }) {
    const prepareFailureCodes = new Set([
      "transaction.prepare.rpc_unavailable",
      "transaction.prepare.gas_estimation_failed",
      "transaction.prepare.fee_estimation_failed",
      "transaction.prepare.nonce_failed",
      "transaction.adapter_missing",
      "transaction.prepare_timeout",
      "transaction.prepare_missing_result",
      "transaction.prepare_failed",
    ]);
    const approveBlockerCodes = new Set(["transaction.prepare.gas_zero", "transaction.prepare.insufficient_funds"]);

    const prepareFailure =
      result.issues.flatMap((issue) =>
        prepareFailureCodes.has(issue.code) ? [this.#toReviewMessage(issue)] : [],
      )[0] ?? null;
    const approvalBlocker =
      result.issues.flatMap((issue) =>
        approveBlockerCodes.has(issue.code) ? [this.#toReviewMessage(issue)] : [],
      )[0] ?? null;
    const reviewNotices = [
      ...result.warnings.map((warning) => this.#toReviewMessage(warning)),
      ...result.issues.flatMap((issue) =>
        prepareFailureCodes.has(issue.code) || approveBlockerCodes.has(issue.code)
          ? []
          : [this.#toReviewMessage(issue)],
      ),
    ];

    return { prepareFailure, approvalBlocker, reviewNotices };
  }

  queuePrepare(id: string) {
    void this.ensurePrepared(id, { source: "background" }).catch((error) => {
      // Best-effort background preparation; failures are surfaced via review session diagnostics.
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
      return this.#runtime.get(id) ?? null;
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

    const meta = this.#runtime.get(id);
    if (!meta) return null;

    if (meta.prepared) {
      return meta;
    }

    // No need to prepare once a tx is no longer eligible for enrichment.
    if (!isPrepareEligibleTransactionStatus(meta.status)) {
      return meta;
    }

    const session = this.#reviewSessions.begin(id, Date.now());
    this.#runtime.patch(id, { updatedAt: meta.updatedAt });

    const adapter = this.#registry.get(meta.namespace);
    if (!adapter) {
      const next = this.#patchAndCommit(
        id,
        {
          prepared: null,
        },
        meta,
      );
      this.#reviewSessions.setPreparedDiagnostics(id, session.sessionToken, next.updatedAt, {
        prepareFailure: {
          code: "transaction.adapter_missing",
          message: `No transaction adapter registered for namespace ${meta.namespace}`,
          details: { namespace: meta.namespace },
        },
        approvalBlocker: null,
        reviewNotices: [],
      });
      this.#reviewSessions.markFailed(id, session.sessionToken, next.updatedAt, {
        reason: "transaction.adapter_missing",
        message: `No transaction adapter registered for namespace ${meta.namespace}`,
        data: { namespace: meta.namespace },
      });
      return next;
    }

    try {
      const context = buildPrepareContext(meta);
      const runPrepare = async () => await this.#withTimeout(adapter.prepareTransaction(context), timeoutMs);
      const result = opts?.source === "background" ? await this.#withPrepareSlot(runPrepare) : await runPrepare();
      const diagnostics = this.#classifyPreparedDiagnostics(result);

      const next = this.#patchAndCommit(
        id,
        {
          prepared: result.prepared,
        },
        meta,
      );
      this.#reviewSessions.setPreparedDiagnostics(id, session.sessionToken, next.updatedAt, diagnostics);
      if (result.prepared) {
        this.#reviewSessions.markReady(id, session.sessionToken, next.updatedAt);
      } else {
        this.#reviewSessions.markFailed(id, session.sessionToken, next.updatedAt, {
          reason: "transaction.prepare_missing_result",
          message: "Transaction preparation did not produce prepared parameters.",
        });
      }
      return next;
    } catch (error) {
      const next = this.#patchAndCommit(
        id,
        {
          prepared: null,
        },
        meta,
      );
      const message =
        error instanceof Error
          ? {
              code: "transaction.prepare_failed",
              message: error.message,
              ...(error.name ? { details: { name: error.name } } : {}),
            }
          : {
              code: "transaction.prepare_failed",
              message: String(error),
            };
      this.#reviewSessions.setPreparedDiagnostics(id, session.sessionToken, next.updatedAt, {
        prepareFailure: message,
        approvalBlocker: null,
        reviewNotices: [],
      });
      this.#reviewSessions.markFailed(id, session.sessionToken, next.updatedAt, {
        reason: message.code,
        message: message.message,
        ...(message.details !== undefined ? { data: message.details } : {}),
      });
      return next;
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
