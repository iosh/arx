import { ArxReasons, isArxError } from "@arx/errors";
import { toAccountIdFromAddress } from "../../accounts/accountId.js";
import { parseChainRef } from "../../chains/caip.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { AccountController } from "../account/types.js";
import type { ApprovalController } from "../approval/types.js";
import { ApprovalTypes } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isExecutableTransactionStatus, isTerminalTransactionStatus } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import type {
  TransactionApprovalChainMetadata,
  TransactionApprovalTask,
  TransactionApprovalTaskPayload,
  TransactionController,
  TransactionError,
  TransactionIssue,
  TransactionMeta,
  TransactionRequest,
  TransactionStatus,
  TransactionWarning,
} from "./types.js";
import {
  buildAdapterContext,
  cloneIssues,
  cloneRequest,
  cloneWarnings,
  coerceTransactionError,
  isUserRejectedError,
  missingAdapterIssue,
  normalizeRequest,
} from "./utils.js";

const DEFAULT_PREPARE_TIMEOUT_MS = 20_000;

type Deps = {
  view: StoreTransactionView;
  network: Pick<NetworkController, "getActiveChain" | "getChain">;
  accounts: Pick<AccountController, "getSelectedAddress" | "getAccounts">;
  approvals: Pick<ApprovalController, "requestApproval">;
  registry: TransactionAdapterRegistry;
  service: TransactionsService;
  prepare: TransactionPrepareManager;
  tracking: TransactionReceiptTracking;
  now: () => number;
};

/**
 * Execution + approvals orchestrator.
 * Owns the in-memory queue for processing approved transactions.
 */
export class TransactionExecutor
  implements
    Pick<
      TransactionController,
      "requestTransactionApproval" | "approveTransaction" | "rejectTransaction" | "processTransaction" | "resumePending"
    >
{
  #view: StoreTransactionView;
  #network: Pick<NetworkController, "getActiveChain" | "getChain">;
  #accounts: Pick<AccountController, "getSelectedAddress" | "getAccounts">;
  #approvals: Pick<ApprovalController, "requestApproval">;
  #registry: TransactionAdapterRegistry;
  #service: TransactionsService;
  #prepare: TransactionPrepareManager;
  #tracking: TransactionReceiptTracking;
  #now: () => number;
  #lastTimestamp = 0;

  #queue: string[] = [];
  #queued: Set<string> = new Set();
  #processing: Set<string> = new Set();
  #scheduled = false;
  #cancelledByUser: Set<string> = new Set();

  constructor(deps: Deps) {
    this.#view = deps.view;
    this.#network = deps.network;
    this.#accounts = deps.accounts;
    this.#approvals = deps.approvals;
    this.#registry = deps.registry;
    this.#service = deps.service;
    this.#prepare = deps.prepare;
    this.#tracking = deps.tracking;
    this.#now = deps.now;
  }

  async requestTransactionApproval(
    origin: string,
    request: TransactionRequest,
    requestContext: RequestContext,
    opts?: { id?: string },
  ): Promise<TransactionMeta> {
    const chainRef = request.chainRef ?? this.#network.getActiveChain()?.chainRef ?? null;
    if (!chainRef) {
      throw new Error("chainRef is required for transactions");
    }

    const derived = parseChainRef(chainRef);
    if (request.namespace !== derived.namespace) {
      throw new Error(`Transaction namespace mismatch: request=${request.namespace} chainRef=${chainRef}`);
    }

    const id = opts?.id ?? crypto.randomUUID();
    const timestamp = this.#nextTimestamp();

    const fromAddress = this.#findFromAddress(request) ?? this.#accounts.getSelectedAddress({ chainRef }) ?? null;
    if (!fromAddress) {
      throw new Error("Transaction from address is required");
    }

    const fromAccountId = toAccountIdFromAddress({ chainRef, address: fromAddress });
    const normalizedRequest = normalizeRequest(request, chainRef);

    // Avoid RPC/slow work before the approval is enqueued.
    const adapter = this.#registry.get(derived.namespace);
    const collectedWarnings: TransactionWarning[] = [];
    const collectedIssues: TransactionIssue[] = adapter ? [] : [missingAdapterIssue(derived.namespace)];

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
      const ownedIds = new Set(ownedAccounts.map((addr) => toAccountIdFromAddress({ chainRef, address: addr })));
      if (!ownedIds.has(fromAccountId)) {
        collectedIssues.push({
          kind: "issue",
          code: "transaction.request.from_not_owned",
          message: "Requested from address is not available in this wallet.",
          severity: "high",
          data: { from: fromAddress, chainRef },
        });
      }
    }

    const created = await this.#service.createPending({
      id,
      createdAt: timestamp,
      namespace: derived.namespace,
      chainRef,
      origin,
      fromAccountId,
      request: cloneRequest(normalizedRequest),
      warnings: cloneWarnings(collectedWarnings),
      issues: cloneIssues(collectedIssues),
    });

    const storedMeta = this.#view.commitRecord(created).next;

    const task = this.#createApprovalTask(storedMeta);
    const approvalPromise = this.#approvals.requestApproval(task, requestContext);

    // Prepare in background to improve confirmation UX and reduce execution latency.
    this.#prepare.queuePrepare(id);

    return approvalPromise;
  }

  async approveTransaction(id: string): Promise<TransactionMeta | null> {
    const existing = this.#view.peek(id) ?? (await this.#view.getOrLoad(id)) ?? null;
    if (!existing) return null;
    if (existing.status !== "pending") return null;

    const updated = await this.#service.transition({
      id,
      fromStatus: "pending",
      toStatus: "approved",
    });
    if (!updated) return null;

    const { next } = this.#view.commitRecord(updated);
    this.#enqueue(next.id);
    return next;
  }

  async rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    const error = coerceTransactionError(reason);
    const wantsUserRejected = isUserRejectedError(reason, error);
    if (wantsUserRejected) {
      // In-memory cancellation hint so in-flight processing can bail before broadcast.
      this.#cancelledByUser.add(id);
    }

    // Best-effort: resolve CAS conflicts by reloading the latest state.
    // This avoids "UI rejected but tx still proceeds" windows when other workers advance the status concurrently.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latestRecord = await this.#service.get(id);
      if (!latestRecord) return;

      const latest = this.#view.commitRecord(latestRecord).next;
      if (isTerminalTransactionStatus(latest.status)) {
        this.#cancelledByUser.delete(id);
        return;
      }

      // User rejection is only meaningful before the tx is broadcast.
      // If it has already reached broadcast, we cannot "un-send" it.
      if (wantsUserRejected && latest.status === "broadcast") {
        this.#cancelledByUser.delete(id);
        return;
      }

      const userRejected = wantsUserRejected && latest.status === "pending";

      const updated = await this.#service.transition({
        id,
        fromStatus: latest.status,
        toStatus: "failed",
        patch: { error, userRejected },
      });

      if (!updated) {
        // CAS conflict: retry with latest state.
        continue;
      }

      this.#queued.delete(id);
      const { previous, next } = this.#view.commitRecord(updated);
      this.#tracking.stop(id);
      this.#tracking.handleTransition(previous, next);
      this.#cancelledByUser.delete(id);
      return;
    }

    // If we couldn't persist the rejection due to contention, do not keep a permanent in-memory cancel flag.
    this.#cancelledByUser.delete(id);
  }

  async processTransaction(id: string): Promise<void> {
    if (this.#isCancelled(id)) {
      // Best-effort cancellation. State transition is handled by rejectTransaction().
      return;
    }

    let meta = await this.#view.getOrLoad(id);
    if (!meta) return;
    if (!isExecutableTransactionStatus(meta.status)) return;

    const adapter = this.#registry.get(meta.namespace);
    if (!adapter) {
      await this.rejectTransaction(id, new Error(`No transaction adapter registered for namespace ${meta.namespace}`));
      return;
    }

    try {
      let prepared = meta.prepared;
      if (!prepared) {
        const next = await this.#prepare.ensurePrepared(id, {
          timeoutMs: DEFAULT_PREPARE_TIMEOUT_MS,
          source: "execution",
        });
        if (!next?.prepared) {
          await this.rejectTransaction(id, new Error("Transaction preparation did not produce prepared parameters"));
          return;
        }
        prepared = next.prepared;
        meta = next;
      }

      const context = buildAdapterContext(meta);
      const signed = await adapter.signTransaction(context, prepared);

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
          signedMeta = this.#view.commitRecord(latest).next;
          if (signedMeta.status !== "signed") return;
        } else {
          signedMeta = this.#view.commitRecord(afterSign).next;
        }
      }

      if (!(await this.#ensureStillSigned(id))) {
        return;
      }

      const broadcast = await adapter.broadcastTransaction(buildAdapterContext(signedMeta), signed);

      const afterBroadcast = await this.#service.transition({
        id,
        fromStatus: "signed",
        toStatus: "broadcast",
        patch: { hash: broadcast.hash },
      });

      if (!afterBroadcast) {
        const latest = await this.#service.get(id);
        if (!latest) return;
        const { previous, next } = this.#view.commitRecord(latest);
        this.#tracking.handleTransition(previous, next);
        return;
      }

      const { previous, next } = this.#view.commitRecord(afterBroadcast);
      this.#tracking.handleTransition(previous, next);
    } catch (err) {
      if (err && isArxError(err) && err.reason === ArxReasons.SessionLocked) {
        return;
      }
      await this.rejectTransaction(id, err instanceof Error ? err : new Error("Transaction processing failed"));
    }
  }

  #isCancelled(id: string): boolean {
    return this.#cancelledByUser.has(id);
  }

  async #ensureStillSigned(id: string): Promise<boolean> {
    if (this.#isCancelled(id)) return false;

    // Cancellation guard: if the tx was rejected/failed concurrently, do not broadcast.
    const record = await this.#service.get(id);
    if (!record) return false;

    const { previous, next } = this.#view.commitRecord(record);
    this.#tracking.handleTransition(previous, next);
    if (next.status !== "signed") return false;

    return !this.#isCancelled(id);
  }

  async resumePending(params?: { includeSigning?: boolean }): Promise<void> {
    const includeSigning = params?.includeSigning ?? true;

    // Warm cache first (best-effort).
    this.#view.requestSync();

    const approved = includeSigning ? await this.#listAllByStatus("approved") : [];
    const signed = includeSigning ? await this.#listAllByStatus("signed") : [];
    const broadcast = await this.#listAllByStatus("broadcast");

    if (includeSigning) {
      for (const record of [...approved, ...signed]) {
        const meta = this.#view.commitRecord(record).next;
        this.#enqueue(meta.id);
      }
    }

    for (const record of broadcast) {
      const meta = this.#view.commitRecord(record).next;
      this.#tracking.resumeBroadcast(meta);
    }
  }

  #enqueue(id: string) {
    if (this.#processing.has(id) || this.#queued.has(id)) return;
    this.#queued.add(id);
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
    this.#queued.delete(next);
    if (this.#processing.has(next)) return this.#scheduleProcess();
    this.#processing.add(next);
    try {
      await this.processTransaction(next);
    } finally {
      this.#processing.delete(next);
      if (this.#queue.length > 0) this.#scheduleProcess();
    }
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

  #findFromAddress(request: TransactionRequest): string | null {
    const payload = request.payload;
    if (payload && typeof payload === "object") {
      const candidate = (payload as { from?: unknown }).from;
      if (typeof candidate === "string") {
        return candidate;
      }
    }
    return null;
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
        warnings: cloneWarnings(meta.warnings),
        issues: cloneIssues(meta.issues),
      } satisfies TransactionApprovalTaskPayload,
    };
  }

  #buildChainMetadata(meta: TransactionMeta): TransactionApprovalChainMetadata | null {
    const explicit = this.#network.getChain(meta.chainRef);
    const active = this.#network.getActiveChain();
    const resolved = explicit ?? (active && active.chainRef === meta.chainRef ? active : null);
    if (!resolved) return null;

    const chainId =
      typeof resolved.chainId === "string" && resolved.chainId.startsWith("0x")
        ? (resolved.chainId as `0x${string}`)
        : null;

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
}
