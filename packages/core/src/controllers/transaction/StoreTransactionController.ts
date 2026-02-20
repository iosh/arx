import { ArxReasons, isArxError } from "@arx/errors";
import { toCanonicalEvmAddress } from "../../chains/address.js";
import type { RequestContextRecord, TransactionRecord } from "../../db/records.js";
import type { TransactionsService } from "../../services/transactions/types.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type {
  ReceiptResolution,
  ReplacementResolution,
  TransactionAdapterContext,
} from "../../transactions/adapters/types.js";
import { createReceiptTracker, type ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import { toEip155AccountIdFromCanonicalAddress, toEip155AddressFromAccountId } from "../../utils/accountId.js";
import type { AccountAddress, AccountController } from "../account/types.js";
import { type ApprovalController, ApprovalTypes } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import type {
  TransactionApprovalChainMetadata,
  TransactionApprovalTask,
  TransactionApprovalTaskPayload,
  TransactionController,
  TransactionError,
  TransactionIssue,
  TransactionMessenger,
  TransactionMeta,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionStateChange,
  TransactionStatus,
  TransactionStatusChange,
  TransactionWarning,
} from "./types.js";

const TRANSACTION_STATUS_CHANGED_TOPIC = "transaction:statusChanged";
const TRANSACTION_STATE_CHANGED_TOPIC = "transaction:stateChanged";
const DEFAULT_PREPARE_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;

const cloneRequest = (request: TransactionRequest): TransactionRequest => {
  if (request.namespace === "eip155") {
    return {
      ...request,
      payload: { ...request.payload },
    };
  }
  return {
    ...request,
    payload: { ...(request.payload as Record<string, unknown>) },
  };
};

const cloneMeta = (meta: TransactionMeta): TransactionMeta => ({
  ...meta,
  request: cloneRequest(meta.request),
  prepared: meta.prepared ? { ...meta.prepared } : null,
});

const toTransactionMeta = (record: TransactionRecord): TransactionMeta => ({
  id: record.id,
  namespace: record.namespace,
  chainRef: record.chainRef,
  origin: record.origin,
  from: toEip155AddressFromAccountId(record.fromAccountId) as AccountAddress,
  request: cloneRequest(record.request),
  prepared: (record.prepared ?? null) as TransactionPrepared | null,
  status: record.status,
  hash: record.hash,
  receipt: (record.receipt ?? null) as TransactionReceipt | null,
  error: record.error ?? null,
  userRejected: record.userRejected,
  warnings: record.warnings.map((w) => ({
    kind: "warning",
    code: w.code,
    message: w.message,
    ...(w.severity !== undefined ? { severity: w.severity } : {}),
    ...(w.data !== undefined ? { data: w.data } : {}),
  })),
  issues: record.issues.map((i) => ({
    kind: "issue",
    code: i.code,
    message: i.message,
    ...(i.severity !== undefined ? { severity: i.severity } : {}),
    ...(i.data !== undefined ? { data: i.data } : {}),
  })),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

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
};

/**
 * Persistent transactions controller:
 * - Single source of truth: TransactionsService (backed by the `transactions` table)
 * - Controller keeps a bounded in-memory cache for synchronous reads (getMeta()).
 * - Recovery: resume broadcast receipt tracking from the table; retry signing/broadcast after unlock.
 */
export class StoreTransactionController implements TransactionController {
  #messenger: TransactionMessenger;
  #network: Pick<NetworkController, "getActiveChain" | "getChain">;
  #accounts: Pick<AccountController, "getSelectedAddress" | "getAccounts">;
  #approvals: Pick<ApprovalController, "requestApproval">;
  #registry: TransactionAdapterRegistry;
  #service: TransactionsService;
  #now: () => number;
  #lastTimestamp = 0;
  #stateLimit: number;

  #records: Map<string, TransactionMeta> = new Map();

  #queue: string[] = [];
  #processing: Set<string> = new Set();
  #scheduled = false;
  #prepareInFlight: Map<string, Promise<void>> = new Map();
  #tracker: ReceiptTracker;

  #stateRevision = 0;
  #statePublishScheduled = false;

  #prepareConcurrencyLimit = DEFAULT_BACKGROUND_PREPARE_CONCURRENCY;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor({
    messenger,
    network,
    accounts,
    approvals,
    registry,
    service,
    now,
    tracker,
    stateLimit,
  }: StoreTransactionControllerOptions) {
    this.#messenger = messenger;
    this.#network = network;
    this.#accounts = accounts;
    this.#approvals = approvals;
    this.#registry = registry;
    this.#service = service;
    this.#now = now ?? Date.now;
    this.#stateLimit = stateLimit ?? 200;

    const trackerDeps = {
      getAdapter: (namespace: string) => this.#registry.get(namespace),
      onReceipt: async (id: string, resolution: ReceiptResolution) => {
        await this.#applyReceiptResolution(id, resolution);
      },
      onReplacement: async (id: string, resolution: ReplacementResolution) => {
        await this.#applyReplacementResolution(id, resolution);
      },
      onTimeout: async (id: string) => {
        await this.#handleTrackerTimeout(id);
      },
      onError: async (id: string, error: unknown) => {
        await this.#handleTrackerError(id, error);
      },
    };

    this.#tracker = tracker ?? createReceiptTracker(trackerDeps);

    this.#service.on("changed", () => {
      void this.#queueSyncFromStore();
    });

    // Best-effort initial sync so RPC/UI can see store-backed transactions quickly after cold starts.
    void this.#queueSyncFromStore();
  }

  getMeta(id: string): TransactionMeta | undefined {
    const existing = this.#touchCache(id);
    return existing ? cloneMeta(existing) : undefined;
  }

  async requestTransactionApproval(
    origin: string,
    request: TransactionRequest,
    requestContext: RequestContextRecord,
    opts?: { id?: string },
  ): Promise<TransactionMeta> {
    if (request.namespace !== "eip155") {
      throw new Error(`Unsupported transaction namespace: ${request.namespace}`);
    }

    const activeChain = this.#network.getActiveChain();
    if (!activeChain) {
      throw new Error("Active chain is required for transactions");
    }

    const chainRef = request.chainRef ?? activeChain.chainRef;

    const id = opts?.id ?? crypto.randomUUID();
    const timestamp = this.#nextTimestamp();
    const fromAddress = this.#findFromAddress(request) ?? this.#accounts.getSelectedAddress({ chainRef }) ?? null;

    if (!fromAddress) {
      throw new Error("Transaction from address is required");
    }

    const normalizedRequest = this.#normalizeRequest(request, chainRef);

    // Avoid RPC/slow work before the approval is enqueued.
    const adapter = this.#registry.get(request.namespace);
    const collectedWarnings: TransactionWarning[] = [];
    const collectedIssues: TransactionIssue[] = adapter ? [] : [this.#missingAdapterIssue(request.namespace)];

    const ownedAccounts = this.#accounts.getAccounts({ chainRef });
    if (ownedAccounts.length === 0) {
      collectedIssues.push({
        kind: "issue",
        code: "transaction.request.no_accounts",
        message: "No accounts are available to sign this transaction.",
        severity: "high",
        data: { chainRef },
      });
    } else {
      const requestedFrom = toCanonicalEvmAddress(fromAddress);
      const ownedCanonical = new Set(ownedAccounts.map((addr) => toCanonicalEvmAddress(addr)));
      if (!ownedCanonical.has(requestedFrom)) {
        collectedIssues.push({
          kind: "issue",
          code: "transaction.request.from_not_owned",
          message: "Requested from address is not available in this wallet.",
          severity: "high",
          data: { from: fromAddress, chainRef },
        });
      }
    }

    const fromAccountId = toEip155AccountIdFromCanonicalAddress(toCanonicalEvmAddress(fromAddress));

    const created = await this.#service.createPending({
      id,
      createdAt: timestamp,
      namespace: request.namespace,
      chainRef,
      origin,
      fromAccountId,
      request: cloneRequest(normalizedRequest),
      warnings: this.#cloneWarnings(collectedWarnings),
      issues: this.#cloneIssues(collectedIssues),
    });

    const storedMeta = toTransactionMeta(created);
    this.#upsertCache(storedMeta);

    const task = this.#createApprovalTask(storedMeta);
    const approvalPromise = this.#approvals.requestApproval(task, requestContext);

    // Prepare in background to improve confirmation UX and reduce execution latency.
    this.#queuePrepare(id);

    return approvalPromise;
  }

  async approveTransaction(id: string): Promise<TransactionMeta | null> {
    const current = this.#records.get(id);
    if (!current) {
      // If the cache misses, attempt a sync before giving up.
      await this.#queueSyncFromStore();
    }
    const existing = this.#records.get(id);
    if (!existing) return null;
    if (existing.status !== "pending") return null;

    const updated = await this.#service.transition({
      id,
      fromStatus: "pending",
      toStatus: "approved",
    });

    if (!updated) return null;

    const next = toTransactionMeta(updated);
    this.#upsertCache(next);
    this.#publishStatusChange(existing, next);
    this.#enqueue(next.id);
    return next;
  }

  async rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    const current = this.#records.get(id);
    if (!current) {
      await this.#queueSyncFromStore();
    }
    const meta = this.#records.get(id);
    if (!meta) return;
    if (meta.status === "confirmed" || meta.status === "failed" || meta.status === "replaced") return;

    const error = this.#coerceTransactionError(reason);
    const isUserRejected =
      (reason && isArxError(reason) && reason.reason === ArxReasons.ApprovalRejected) ||
      error?.code === 4001 ||
      error?.name === "TransactionRejectedError";

    const updated = await this.#service.transition({
      id,
      fromStatus: meta.status,
      toStatus: "failed",
      patch: { error, userRejected: isUserRejected },
    });

    if (!updated) return;

    const next = toTransactionMeta(updated);
    this.#upsertCache(next);
    this.#tracker.stop(id);
    this.#publishStatusChange(meta, next);
  }

  async processTransaction(id: string): Promise<void> {
    let meta = this.getMeta(id);
    if (!meta) {
      const record = await this.#service.get(id);
      if (!record) return;
      meta = toTransactionMeta(record);
      this.#upsertCache(meta);
    }
    if (!["approved", "signed"].includes(meta.status)) return;

    const adapter = this.#registry.get(meta.namespace);
    if (!adapter) {
      await this.rejectTransaction(id, new Error(`No transaction adapter registered for namespace ${meta.namespace}`));
      return;
    }

    let context = this.#buildContext(meta);

    try {
      let prepared = meta.prepared;
      if (!prepared) {
        // Prepare on-demand for execution (may be slow; must be bounded).
        const next = await this.#ensurePrepared(id, { timeoutMs: DEFAULT_PREPARE_TIMEOUT_MS, source: "execution" });
        if (!next?.prepared) {
          await this.rejectTransaction(id, new Error("Transaction preparation did not produce prepared parameters"));
          return;
        }
        prepared = next.prepared;
        meta = next;
        context = this.#buildContext(meta);
      }

      const signed = await adapter.signTransaction(context, prepared);
      // Persist the approved -> signed transition only when we are actually in the approved state.
      // When resuming a previously-signed transaction we may re-sign (raw tx bytes are not persisted),
      // but we keep the status as "signed" until broadcast succeeds.
      let signedMeta: TransactionMeta = meta;
      if (meta.status === "approved") {
        const afterSign = await this.#service.transition({
          id,
          fromStatus: "approved",
          toStatus: "signed",
          patch: { hash: signed.hash ?? null },
        });

        if (!afterSign) {
          const latest = await this.#service.get(id);
          if (!latest) return;
          const latestMeta = toTransactionMeta(latest);
          this.#upsertCache(latestMeta);
          this.#publishStatusChange(meta, latestMeta);

          // If another worker already completed the approval -> signed transition, continue.
          if (latestMeta.status !== "signed") {
            return;
          }

          signedMeta = latestMeta;
        } else {
          signedMeta = toTransactionMeta(afterSign);
          this.#upsertCache(signedMeta);
          this.#publishStatusChange(meta, signedMeta);
        }
      }

      context = this.#buildContext(signedMeta);

      const broadcast = await adapter.broadcastTransaction(context, signed);

      const afterBroadcast = await this.#service.transition({
        id,
        fromStatus: "signed",
        toStatus: "broadcast",
        patch: { hash: broadcast.hash },
      });

      if (!afterBroadcast) {
        const latest = await this.#service.get(id);
        if (!latest) return;
        const latestMeta = toTransactionMeta(latest);
        this.#upsertCache(latestMeta);
        this.#publishStatusChange(signedMeta, latestMeta);
        this.#handleTrackerTransition(signedMeta, latestMeta);
        return;
      }

      const afterBroadcastMeta = toTransactionMeta(afterBroadcast);
      this.#upsertCache(afterBroadcastMeta);
      this.#publishStatusChange(signedMeta, afterBroadcastMeta);
      this.#handleTrackerTransition(signedMeta, afterBroadcastMeta);
    } catch (err) {
      // Treat locked sessions as a recoverable pause (retry after unlock).
      if (err && isArxError(err) && err.reason === ArxReasons.SessionLocked) {
        return;
      }

      await this.rejectTransaction(id, err instanceof Error ? err : new Error("Transaction processing failed"));
    }
  }

  async resumePending(params?: { includeSigning?: boolean }): Promise<void> {
    // Table-driven recovery:
    // - broadcast: resume receipt tracking
    // - approved/signed: optionally enqueue for processing (requires signing)
    await this.#queueSyncFromStore();

    const includeSigning = params?.includeSigning ?? true;
    const approved = includeSigning ? await this.#listAllByStatus("approved") : [];
    const signed = includeSigning ? await this.#listAllByStatus("signed") : [];
    const broadcast = await this.#listAllByStatus("broadcast");

    if (includeSigning) {
      for (const record of [...approved, ...signed]) {
        const meta = toTransactionMeta(record);
        this.#upsertCache(meta);
        this.#enqueue(meta.id);
      }
    }

    for (const record of broadcast) {
      const meta = toTransactionMeta(record);
      this.#upsertCache(meta);
      if (typeof meta.hash === "string") {
        this.#tracker.resume(meta.id, this.#buildContext(meta), meta.hash);
      }
    }
  }
  onStatusChanged(handler: (meta: TransactionStatusChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATUS_CHANGED_TOPIC, handler);
  }

  onStateChanged(handler: (change: TransactionStateChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATE_CHANGED_TOPIC, handler);
  }

  #publishStatusChange(previous: TransactionMeta, next: TransactionMeta) {
    if (previous.status === next.status) return;
    this.#messenger.publish(TRANSACTION_STATUS_CHANGED_TOPIC, {
      id: next.id,
      previousStatus: previous.status,
      nextStatus: next.status,
      meta: cloneMeta(next),
    });
  }

  #scheduleStateChanged() {
    if (this.#statePublishScheduled) return;
    this.#statePublishScheduled = true;

    queueMicrotask(() => {
      this.#statePublishScheduled = false;
      this.#stateRevision += 1;
      this.#messenger.publish(TRANSACTION_STATE_CHANGED_TOPIC, { revision: this.#stateRevision });
    });
  }

  #enqueue(id: string) {
    if (this.#processing.has(id) || this.#queue.includes(id)) return;
    this.#queue.push(id);
    this.#scheduleProcess();
  }

  #scheduleProcess() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    Promise.resolve().then(() => {
      this.#scheduled = false;
      void this.#processQueue();
    });
  }

  async #processQueue() {
    const next = this.#queue.shift();
    if (!next) return;
    if (this.#processing.has(next)) return this.#scheduleProcess();
    this.#processing.add(next);
    try {
      await this.processTransaction(next);
    } finally {
      this.#processing.delete(next);
      if (this.#queue.length > 0) this.#scheduleProcess();
    }
  }

  #upsertCache(meta: TransactionMeta) {
    // Maintain a bounded LRU cache for synchronous reads (e.g. getMeta()).
    this.#records.delete(meta.id);
    this.#records.set(meta.id, cloneMeta(meta));

    while (this.#records.size > this.#stateLimit) {
      const oldest = this.#records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#records.delete(oldest);
    }

    this.#scheduleStateChanged();
  }

  #touchCache(id: string): TransactionMeta | undefined {
    const existing = this.#records.get(id);
    if (!existing) return undefined;
    this.#records.delete(id);
    this.#records.set(id, existing);
    return existing;
  }

  #nextTimestamp(): number {
    const value = this.#now();
    if (value <= this.#lastTimestamp) {
      this.#lastTimestamp += 1;
      return this.#lastTimestamp;
    }
    this.#lastTimestamp = value;
    return value;
  }

  async #queueSyncFromStore(): Promise<void> {
    // Only sync a bounded window for synchronous reads; recovery uses explicit status queries.
    const recent = await this.#service.list({ limit: this.#stateLimit * 2 });
    // Insert oldest -> newest so LRU eviction keeps the most recent entries.
    for (const record of [...recent].reverse()) {
      const meta = toTransactionMeta(record);
      this.#upsertCache(meta);
    }
  }

  async #listAllByStatus(status: TransactionStatus) {
    const out: TransactionRecord[] = [];
    let cursor: number | undefined;

    while (true) {
      const page = await this.#service.list({
        status,
        limit: 200,
        ...(cursor !== undefined ? { beforeCreatedAt: cursor } : {}),
      });
      if (page.length === 0) break;
      out.push(...page);
      cursor = page.at(-1)?.createdAt;
      if (cursor === undefined) break;
    }

    return out;
  }

  #buildContext(meta: TransactionMeta): TransactionAdapterContext {
    return {
      namespace: meta.namespace,
      chainRef: meta.chainRef,
      origin: meta.origin,
      from: meta.from,
      request: cloneRequest(meta.request),
      meta: cloneMeta(meta),
    };
  }

  #queuePrepare(id: string) {
    void this.#ensurePrepared(id, { source: "background" }).catch((error) => {
      // Best-effort background preparation; failures are surfaced via issues on the transaction record.
      console.warn("[StoreTransactionController] prepareTransaction failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async #ensurePrepared(
    id: string,
    opts?: { timeoutMs?: number; source?: "background" | "execution" },
  ): Promise<TransactionMeta | null> {
    const existing = this.#prepareInFlight.get(id);
    if (existing) {
      await existing;
      return this.getMeta(id) ?? null;
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
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;

    let meta = this.getMeta(id);
    if (!meta) {
      const record = await this.#service.get(id);
      if (!record) return null;
      meta = toTransactionMeta(record);
      this.#upsertCache(meta);
    }

    if (meta.prepared) {
      return meta;
    }

    const adapter = this.#registry.get(meta.namespace);
    if (!adapter) {
      const patched = await this.#service.patch({
        id,
        patch: {
          prepared: null,
          warnings: meta.warnings,
          issues: this.#cloneIssues([...meta.issues, this.#missingAdapterIssue(meta.namespace)]),
        },
      });
      if (!patched) return meta;
      const next = toTransactionMeta(patched);
      this.#upsertCache(next);
      return next;
    }

    try {
      const context = this.#buildContext(meta);
      const runPrepare = async () => await this.#withTimeout(adapter.prepareTransaction(context), timeoutMs);
      const result = opts?.source === "background" ? await this.#withPrepareSlot(runPrepare) : await runPrepare();

      const patched = await this.#service.patch({
        id,
        patch: {
          prepared: result.prepared,
          warnings: this.#cloneWarnings(this.#mergeWarnings(meta.warnings, result.warnings)),
          issues: this.#cloneIssues(this.#mergeIssues(meta.issues, result.issues)),
        },
      });

      if (!patched) {
        const latest = await this.#service.get(id);
        if (!latest) return meta;
        const latestMeta = toTransactionMeta(latest);
        this.#upsertCache(latestMeta);
        return latestMeta;
      }

      const next = toTransactionMeta(patched);
      this.#upsertCache(next);
      return next;
    } catch (error) {
      const issue = this.#issueFromPrepareError(error);
      const patched = await this.#service.patch({
        id,
        patch: {
          prepared: null,
          warnings: meta.warnings,
          issues: this.#cloneIssues(this.#mergeIssues(meta.issues, [issue])),
        },
      });
      if (!patched) return meta;
      const next = toTransactionMeta(patched);
      this.#upsertCache(next);
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

  #issueFromPrepareError(error: unknown): TransactionIssue {
    if (error instanceof Error) {
      return {
        kind: "issue",
        code: "transaction.prepare_failed",
        message: error.message,
        severity: "high",
        data: { name: error.name },
      };
    }
    return {
      kind: "issue",
      code: "transaction.prepare_failed",
      message: String(error),
      severity: "high",
    };
  }

  #findFromAddress(request: TransactionRequest): AccountAddress | null {
    const payload = request.payload;
    if (payload && typeof payload === "object") {
      const candidate = (payload as { from?: unknown }).from;
      if (typeof candidate === "string") {
        return candidate as AccountAddress;
      }
    }
    return null;
  }

  #normalizeRequest(request: TransactionRequest, chainRef: TransactionMeta["chainRef"]): TransactionRequest {
    const out: TransactionRequest = { ...request, chainRef };

    if (out.namespace !== "eip155") {
      return out;
    }

    const payload = { ...(out.payload as Record<string, unknown>) } as { chainId?: unknown };
    if (typeof payload.chainId === "string" && payload.chainId.startsWith("0x")) {
      return { ...out, payload } as TransactionRequest;
    }

    const explicit = this.#network.getChain(chainRef);
    const active = this.#network.getActiveChain();
    const resolved = explicit ?? (active && active.chainRef === chainRef ? active : null);
    const chainId = resolved?.chainId;
    if (typeof chainId !== "string" || !chainId.startsWith("0x")) {
      throw new Error("chainId is required for eip155 transactions");
    }

    return { ...out, payload: { ...payload, chainId } } as TransactionRequest;
  }

  #cloneWarnings(list: TransactionWarning[]): TransactionWarning[] {
    return list.map((warning) => ({ ...warning }));
  }

  #cloneIssues(list: TransactionIssue[]): TransactionIssue[] {
    return list.map((issue) => ({ ...issue }));
  }

  #mergeWarnings(base: TransactionWarning[], next: TransactionWarning[]): TransactionWarning[] {
    const out: TransactionWarning[] = [];
    const seen = new Set<string>();

    for (const item of [...base, ...next]) {
      const key = `${item.code}:${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }

    return out;
  }

  #mergeIssues(base: TransactionIssue[], next: TransactionIssue[]): TransactionIssue[] {
    const out: TransactionIssue[] = [];
    const seen = new Set<string>();

    for (const item of [...base, ...next]) {
      const key = `${item.code}:${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }

    return out;
  }

  #missingAdapterIssue(namespace: string): TransactionIssue {
    return {
      kind: "issue",
      code: "transaction.adapter_missing",
      message: `No transaction adapter registered for namespace ${namespace}`,
      severity: "high",
      data: { namespace },
    };
  }

  #createApprovalTask(meta: TransactionMeta): TransactionApprovalTask {
    return {
      id: meta.id,
      type: ApprovalTypes.SendTransaction,
      origin: meta.origin,
      namespace: meta.request.namespace,
      chainRef: meta.chainRef,
      createdAt: meta.createdAt,
      payload: {
        chainRef: meta.chainRef,
        origin: meta.origin,
        chain: this.#buildChainMetadata(meta),
        from: meta.from,
        request: cloneRequest(meta.request),
        warnings: this.#cloneWarnings(meta.warnings),
        issues: this.#cloneIssues(meta.issues),
      } satisfies TransactionApprovalTaskPayload,
    };
  }

  #buildChainMetadata(meta: TransactionMeta): TransactionApprovalChainMetadata | null {
    const explicit = this.#network.getChain(meta.chainRef);
    const active = this.#network.getActiveChain();
    const resolved = explicit ?? (active.chainRef === meta.chainRef ? active : null);
    if (!resolved) return null;

    const chainId = resolved.chainId.startsWith("0x") ? (resolved.chainId as `0x${string}`) : null;

    return {
      chainRef: resolved.chainRef,
      namespace: resolved.namespace,
      name: resolved.displayName,
      shortName: resolved.shortName ?? null,
      chainId,
      nativeCurrency: resolved.nativeCurrency
        ? { symbol: resolved.nativeCurrency.symbol, decimals: resolved.nativeCurrency.decimals }
        : null,
    };
  }

  #coerceTransactionError(reason?: Error | TransactionError | undefined): TransactionError | undefined {
    if (!reason) return undefined;
    if ("name" in reason && "message" in reason && typeof reason.name === "string") {
      const error: TransactionError = {
        name: reason.name,
        message: reason.message ?? "",
      };
      const extra = reason as unknown as { code?: unknown; data?: unknown };
      if (typeof extra.code === "number") {
        error.code = extra.code;
      }
      if ("data" in extra) {
        error.data = extra.data;
      }
      return error;
    }
    return {
      name: "Error",
      message: String(reason),
    };
  }

  #handleTrackerTransition(previous: TransactionMeta, next: TransactionMeta) {
    if (next.status === "broadcast" && typeof next.hash === "string") {
      const context = this.#buildContext(next);
      if (this.#tracker.isTracking(next.id)) {
        this.#tracker.resume(next.id, context, next.hash);
      } else {
        this.#tracker.start(next.id, context, next.hash);
      }
      return;
    }

    if (previous.status === "broadcast" && next.status !== "broadcast") {
      this.#tracker.stop(next.id);
      return;
    }

    if (next.status === "confirmed" || next.status === "failed" || next.status === "replaced") {
      this.#tracker.stop(next.id);
    }
  }

  async #applyReceiptResolution(id: string, resolution: ReceiptResolution): Promise<void> {
    const meta = this.#records.get(id);
    if (!meta || meta.status !== "broadcast") return;

    if (resolution.status === "success") {
      const updated = await this.#service.transition({
        id,
        fromStatus: "broadcast",
        toStatus: "confirmed",
        patch: { receipt: resolution.receipt, error: undefined, userRejected: false },
      });
      if (!updated) return;
      const next = toTransactionMeta(updated);
      this.#upsertCache(next);
      this.#handleTrackerTransition(meta, next);
      this.#publishStatusChange(meta, next);
      return;
    }

    const updated = await this.#service.transition({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: {
        receipt: resolution.receipt,
        error: {
          name: "TransactionExecutionFailed",
          message: "Transaction execution failed.",
          data: resolution.receipt,
        },
        userRejected: false,
      },
    });
    if (!updated) return;
    const next = toTransactionMeta(updated);
    this.#upsertCache(next);
    this.#handleTrackerTransition(meta, next);

    this.#publishStatusChange(meta, next);
  }

  async #applyReplacementResolution(id: string, resolution: ReplacementResolution): Promise<void> {
    const meta = this.#records.get(id);
    if (!meta || meta.status !== "broadcast") return;

    const updated = await this.#service.transition({
      id,
      fromStatus: "broadcast",
      toStatus: "replaced",
      patch: {
        hash: resolution.hash ?? meta.hash,
        error: {
          name: "TransactionReplacedError",
          message: "Transaction was replaced by another transaction with the same nonce.",
          data: { replacementHash: resolution.hash },
        },
        userRejected: false,
      },
    });
    if (!updated) return;
    const next = toTransactionMeta(updated);
    this.#upsertCache(next);
    this.#handleTrackerTransition(meta, next);
    this.#publishStatusChange(meta, next);
  }

  async #handleTrackerTimeout(id: string): Promise<void> {
    const meta = this.#records.get(id);
    if (!meta || meta.status !== "broadcast") return;

    const updated = await this.#service.transition({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: {
        error: {
          name: "TransactionReceiptTimeoutError",
          message: "Timed out waiting for transaction receipt.",
        },
        userRejected: false,
      },
    });
    if (!updated) return;
    const next = toTransactionMeta(updated);
    this.#upsertCache(next);
    this.#handleTrackerTransition(meta, next);
    this.#publishStatusChange(meta, next);
  }

  async #handleTrackerError(id: string, error: unknown): Promise<void> {
    const meta = this.#records.get(id);
    if (!meta || meta.status !== "broadcast") return;

    const message = error instanceof Error ? error.message : String(error);
    const updated = await this.#service.transition({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: {
        error: {
          name: "ReceiptTrackingError",
          message,
          data: error instanceof Error ? { name: error.name } : undefined,
        },
        userRejected: false,
      },
    });
    if (!updated) return;
    const next = toTransactionMeta(updated);
    this.#upsertCache(next);
    this.#handleTrackerTransition(meta, next);
    this.#publishStatusChange(meta, next);
  }
}
