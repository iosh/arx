import { ArxReasons, isArxError } from "@arx/errors";
import { toCanonicalEvmAddress } from "../../chains/address.js";
import type { RequestContextRecord, TransactionRecord } from "../../db/records.js";
import type { TransactionsService } from "../../services/transactions/types.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type {
  ReceiptResolution,
  ReplacementResolution,
  TransactionAdapterContext,
  TransactionDraft,
} from "../../transactions/adapters/types.js";
import { createReceiptTracker, type ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { AccountAddress, AccountController } from "../account/types.js";
import { type ApprovalController, ApprovalTypes } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import type {
  TransactionApprovalChainMetadata,
  TransactionApprovalDecodedPayload,
  TransactionApprovalTask,
  TransactionApprovalTaskPayload,
  TransactionController,
  TransactionDraftPreview,
  TransactionError,
  TransactionIssue,
  TransactionMessenger,
  TransactionMeta,
  TransactionReceipt,
  TransactionRequest,
  TransactionStatus,
  TransactionStatusChange,
  TransactionWarning,
} from "./types.js";

const TRANSACTION_STATUS_CHANGED_TOPIC = "transaction:statusChanged";

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
});

const toAccountIdFromEip155Address = (address: string): string => {
  const canonical = toCanonicalEvmAddress(address);
  const payloadHex = canonical.slice(2); // strip 0x
  return `eip155:${payloadHex}`;
};

const toEip155AddressFromAccountId = (accountId: string): string => {
  // Assumes CAIP-10-like `eip155:<hex40>` account id format for now.
  const [, payloadHex] = accountId.split(":");
  return `0x${payloadHex ?? ""}`.toLowerCase();
};

const toTransactionMeta = (record: TransactionRecord): TransactionMeta => ({
  id: record.id,
  namespace: record.namespace,
  chainRef: record.chainRef,
  origin: record.origin,
  from: toEip155AddressFromAccountId(record.fromAccountId) as AccountAddress,
  request: cloneRequest(record.request),
  status: record.status,
  hash: record.hash,
  receipt: (record.receipt ?? null) as TransactionReceipt | null,
  error: record.error ?? null,
  userRejected: record.userRejected,
  warnings: record.warnings.map((w) => ({ ...w })),
  issues: record.issues.map((i) => ({ ...i })),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export type StoreTransactionControllerOptions = {
  messenger: TransactionMessenger;
  network: Pick<NetworkController, "getActiveChain" | "getChain">;
  accounts: Pick<AccountController, "getActivePointer">;
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
  #accounts: Pick<AccountController, "getActivePointer">;
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
  #drafts: Map<string, TransactionDraft> = new Map();
  #tracker: ReceiptTracker;

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

  async submitTransaction(
    origin: string,
    request: TransactionRequest,
    requestContext?: RequestContextRecord | null,
  ): Promise<TransactionMeta> {
    if (request.namespace !== "eip155") {
      throw new Error(`Unsupported transaction namespace: ${request.namespace}`);
    }

    const activeChain = this.#network.getActiveChain();
    if (!activeChain) {
      throw new Error("Active chain is required for transactions");
    }

    const chainRef = request.chainRef ?? activeChain.chainRef;
    const adapter = this.#registry.get(request.namespace);

    const id = crypto.randomUUID();
    const timestamp = this.#nextTimestamp();
    const fromAddress = this.#findFromAddress(request) ?? this.#accounts.getActivePointer()?.address ?? null;

    if (!fromAddress) {
      throw new Error("Transaction from address is required");
    }

    const normalizedRequest = this.#normalizeRequest(request, chainRef);

    // Precompute warnings/issues/draft preview before persisting the pending record.
    let draftPreview: TransactionDraftPreview | null = null;
    let collectedWarnings: TransactionWarning[] = [];
    let collectedIssues: TransactionIssue[] = [];

    const metaCandidate: TransactionMeta = {
      id,
      namespace: request.namespace,
      chainRef,
      origin,
      from: fromAddress,
      request: cloneRequest(normalizedRequest),
      status: "pending",
      hash: null,
      receipt: null,
      error: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (adapter) {
      try {
        const draftContext = this.#buildContext(metaCandidate);
        const draft = await adapter.buildDraft(draftContext);
        collectedWarnings = this.#cloneWarnings(draft.warnings);
        collectedIssues = this.#cloneIssues(draft.issues);
        draftPreview = this.#buildPreviewFromDraft(draft);
        this.#drafts.set(id, draft);
      } catch (error) {
        const issue = this.#issueFromDraftError(error);
        collectedIssues = [issue];
        draftPreview = this.#buildPreviewFromIssue(issue, { stage: "draft" });
        this.#drafts.delete(id);
      }
    } else {
      const issue = this.#missingAdapterIssue(request.namespace);
      collectedIssues = [issue];
      draftPreview = this.#buildPreviewFromIssue(issue, { namespace: request.namespace });
      this.#drafts.delete(id);
    }

    const fromAccountId = toAccountIdFromEip155Address(fromAddress);

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

    const activeDraft = this.#drafts.get(id) ?? null;
    const task = this.#createApprovalTask(storedMeta, activeDraft, draftPreview);

    return this.#approvals.requestApproval(task, requestContext ?? null) as Promise<TransactionMeta>;
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
    this.#drafts.delete(id);
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
      let draft = this.#drafts.get(id);
      if (!draft) {
        draft = await adapter.buildDraft(context);
        this.#drafts.set(id, draft);
      }

      const signed = await adapter.signTransaction(context, draft);
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
        this.#drafts.delete(id);
        this.#publishStatusChange(signedMeta, latestMeta);
        this.#handleTrackerTransition(signedMeta, latestMeta);
        return;
      }

      const afterBroadcastMeta = toTransactionMeta(afterBroadcast);
      this.#upsertCache(afterBroadcastMeta);
      this.#drafts.delete(id);
      this.#publishStatusChange(signedMeta, afterBroadcastMeta);
      this.#handleTrackerTransition(signedMeta, afterBroadcastMeta);
    } catch (err) {
      // Treat locked sessions as a recoverable pause (retry after unlock).
      if (err && isArxError(err) && err.reason === ArxReasons.SessionLocked) {
        this.#drafts.delete(id);
        return;
      }

      this.#drafts.delete(id);
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

  #publishStatusChange(previous: TransactionMeta, next: TransactionMeta) {
    if (previous.status === next.status) return;
    this.#messenger.publish(TRANSACTION_STATUS_CHANGED_TOPIC, {
      id: next.id,
      previousStatus: previous.status,
      nextStatus: next.status,
      meta: cloneMeta(next),
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

  #buildPreviewFromDraft(draft: TransactionDraft): TransactionDraftPreview {
    return {
      summary: { ...draft.summary },
      warnings: this.#cloneWarnings(draft.warnings),
      issues: this.#cloneIssues(draft.issues),
    };
  }

  #buildPreviewFromIssue(issue: TransactionIssue, extras?: Record<string, unknown>): TransactionDraftPreview {
    return {
      summary: { code: issue.code, message: issue.message, ...(extras ?? {}) },
      warnings: [],
      issues: this.#cloneIssues([issue]),
    };
  }

  #issueFromDraftError(error: unknown): TransactionIssue {
    if (error instanceof Error) {
      return {
        code: "transaction.draft_failed",
        message: error.message,
        data: { name: error.name },
      };
    }
    return {
      code: "transaction.draft_failed",
      message: String(error),
    };
  }

  #missingAdapterIssue(namespace: string): TransactionIssue {
    return {
      code: "transaction.adapter_missing",
      message: `No transaction adapter registered for namespace ${namespace}`,
      data: { namespace },
    };
  }

  #createApprovalTask(
    meta: TransactionMeta,
    draft: TransactionDraft | null,
    preview: TransactionDraftPreview | null,
  ): TransactionApprovalTask {
    const warningsSource = preview?.warnings ?? meta.warnings;
    const issuesSource = preview?.issues ?? meta.issues;

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
        draft: preview ? this.#cloneDraftPreview(preview) : null,
        prepared: draft ? this.#clonePrepared(draft.prepared) : null,
        decoded: this.#buildDecodedPayload(meta),
        warnings: this.#cloneWarnings(warningsSource),
        issues: this.#cloneIssues(issuesSource),
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

  #clonePrepared(prepared: Record<string, unknown>): Record<string, unknown> {
    return { ...prepared };
  }

  #buildDecodedPayload(meta: TransactionMeta): TransactionApprovalDecodedPayload | null {
    const payload = meta.request.payload;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return { ...(payload as Record<string, unknown>) };
  }

  #cloneDraftPreview(preview: TransactionDraftPreview): TransactionDraftPreview {
    return {
      summary: { ...preview.summary },
      warnings: this.#cloneWarnings(preview.warnings),
      issues: this.#cloneIssues(preview.issues),
    };
  }

  #coerceTransactionError(reason?: Error | TransactionError | undefined): TransactionError | undefined {
    if (!reason) return undefined;
    if ("name" in reason && "message" in reason && typeof reason.name === "string") {
      const error: TransactionError = {
        name: reason.name,
        message: reason.message ?? "",
      };
      if ("code" in reason && typeof (reason as any).code === "number") {
        (error as any).code = (reason as any).code;
      }
      if ("data" in reason) {
        (error as any).data = (reason as any).data;
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
