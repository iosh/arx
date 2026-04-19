import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { requestApproval } from "../../approvals/creation.js";
import { parseChainRef } from "../../chains/caip.js";
import type { AccountController, OwnedAccountView } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { ApprovalController, ApprovalHandle } from "../approval/types.js";
import { ApprovalKinds } from "../approval/types.js";
import type { SupportedChainsController } from "../supportedChains/types.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isExecutableTransactionStatus, isTerminalTransactionStatus } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import type {
  BeginTransactionApprovalOptions,
  ResumePendingTransactionsOptions,
  TransactionApprovalChainMetadata,
  TransactionApprovalHandoff,
  TransactionApprovalRequestPayload,
  TransactionController,
  TransactionError,
  TransactionMeta,
  TransactionRequest,
  TransactionStatus,
  TransactionWarning,
} from "./types.js";
import {
  buildPrepareContext,
  buildSignContext,
  cloneIssues,
  cloneRequest,
  cloneWarnings,
  coerceTransactionError,
  createMissingAdapterError,
  createReceiptTrackingUnsupportedError,
  createTransactionSubmissionUnavailableError,
  isUserRejectedError,
} from "./utils.js";

const DEFAULT_PREPARE_TIMEOUT_MS = 20_000;

type Deps = {
  view: StoreTransactionView;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  supportedChains: Pick<SupportedChainsController, "getChain">;
  accounts: Pick<AccountController, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create">;
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
      "beginTransactionApproval" | "approveTransaction" | "rejectTransaction" | "processTransaction" | "resumePending"
    >
{
  #view: StoreTransactionView;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  #supportedChains: Pick<SupportedChainsController, "getChain">;
  #accounts: Pick<AccountController, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  #approvals: Pick<ApprovalController, "create">;
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
  #releasedRetainedExecutionIds: Set<string> = new Set();

  constructor(deps: Deps) {
    this.#view = deps.view;
    this.#accountCodecs = deps.accountCodecs;
    this.#networkSelection = deps.networkSelection;
    this.#supportedChains = deps.supportedChains;
    this.#accounts = deps.accounts;
    this.#approvals = deps.approvals;
    this.#registry = deps.registry;
    this.#service = deps.service;
    this.#prepare = deps.prepare;
    this.#tracking = deps.tracking;
    this.#now = deps.now;
  }

  async beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options?: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalHandoff> {
    const namespaceActiveChainRef = this.#networkSelection.getSelectedChainRef(request.namespace);
    const chainRef = request.chainRef ?? namespaceActiveChainRef ?? null;
    if (!chainRef) {
      throw new Error("chainRef is required for transactions");
    }

    const derived = parseChainRef(chainRef);
    if (request.namespace !== derived.namespace) {
      throw new Error(`Transaction namespace mismatch: request=${request.namespace} chainRef=${chainRef}`);
    }

    const id = crypto.randomUUID();
    const timestamp = this.#nextTimestamp();

    const fromAddress =
      this.#findFromAddress(request) ??
      this.#accounts.getActiveAccountForNamespace({ namespace: derived.namespace, chainRef })?.canonicalAddress ??
      null;
    if (!fromAddress) {
      throw new Error("Transaction from address is required");
    }

    const fromAccountKey = this.#accountCodecs.toAccountKeyFromAddress({ chainRef, address: fromAddress });
    const adapter = this.#registry.get(derived.namespace);
    if (adapter && !adapter.receiptTracking) {
      throw createTransactionSubmissionUnavailableError({ namespace: derived.namespace, chainRef });
    }
    if (!adapter) {
      throw createMissingAdapterError(derived.namespace);
    }
    const derivedRequestCandidate = adapter.deriveRequestForChain?.(request, chainRef) ?? {
      ...request,
      chainRef,
    };
    if (derivedRequestCandidate.namespace !== derived.namespace) {
      throw new Error(
        `Transaction adapter derived request namespace mismatch: expected=${derived.namespace} actual=${derivedRequestCandidate.namespace}`,
      );
    }
    if (derivedRequestCandidate.chainRef !== undefined && derivedRequestCandidate.chainRef !== chainRef) {
      throw new Error(
        `Transaction adapter derived request chainRef mismatch: expected=${chainRef} actual=${derivedRequestCandidate.chainRef}`,
      );
    }

    const derivedRequest: TransactionRequest = {
      ...derivedRequestCandidate,
      chainRef,
    };
    this.#requireOwnedFromAccount({
      namespace: derived.namespace,
      chainRef,
      fromAddress,
      fromAccountKey,
    });
    adapter.validateRequest?.(derivedRequest);

    const created = await this.#service.createPending({
      id,
      createdAt: timestamp,
      namespace: derived.namespace,
      chainRef,
      origin: requestContext.origin,
      fromAccountKey: fromAccountKey,
      request: cloneRequest(derivedRequest),
      warnings: [],
      issues: [],
    });

    const storedMeta = this.#view.commitRecord(created).next;

    const approvalRequest = this.#createApprovalRequest(storedMeta);
    const approvalId = crypto.randomUUID();
    let approvalHandle: ApprovalHandle<typeof ApprovalKinds.SendTransaction>;
    try {
      approvalHandle = options?.providerRequestHandle
        ? options.providerRequestHandle.attachBlockingApproval(
            ({ approvalId, createdAt }) =>
              requestApproval(
                {
                  approvals: this.#approvals,
                  now: this.#now,
                },
                {
                  kind: ApprovalKinds.SendTransaction,
                  requestContext,
                  approvalId,
                  createdAt,
                  request: approvalRequest,
                },
              ),
            {
              // Transaction-backed approvals keep a stable 1:1 link with the transaction record.
              approvalId,
              createdAt: storedMeta.createdAt,
            },
          )
        : requestApproval(
            {
              approvals: this.#approvals,
              now: this.#now,
            },
            {
              kind: ApprovalKinds.SendTransaction,
              requestContext,
              approvalId,
              createdAt: storedMeta.createdAt,
              request: approvalRequest,
            },
          );
    } catch (error) {
      const rejectionError = error instanceof Error ? error : new Error(String(error));
      await this.rejectTransaction(storedMeta.id, rejectionError);
      throw error;
    }
    const approvalPromise = approvalHandle.settled;

    // Prepare in background to improve confirmation UX and reduce execution latency.
    this.#prepare.queuePrepare(id);

    return {
      transactionId: storedMeta.id,
      approvalId: approvalHandle.approvalId,
      pendingMeta: storedMeta,
      waitForApprovalDecision: () => approvalPromise,
    };
  }

  #requireOwnedFromAccount(params: {
    namespace: string;
    chainRef: string;
    fromAddress: string;
    fromAccountKey: string;
  }): OwnedAccountView {
    const { namespace, chainRef, fromAddress, fromAccountKey } = params;
    const ownedAccount = this.#accounts.listOwnedForNamespace({ namespace, chainRef }).find((account) => {
      return account.accountKey === fromAccountKey;
    });
    if (ownedAccount) {
      return ownedAccount;
    }

    const activeAccount = this.#accounts.getActiveAccountForNamespace({ namespace, chainRef });
    if (!activeAccount) {
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: "No accounts are available to sign this transaction.",
        data: { chainRef, namespace },
      });
    }

    throw arxError({
      reason: ArxReasons.PermissionDenied,
      message: "Requested from address is not available in this wallet.",
      data: { from: fromAddress, chainRef },
    });
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

    // Keep retrying until the status settles because transaction status only
    // moves forward across a finite state machine.
    while (true) {
      const latestRecord = await this.#service.get(id);
      if (!latestRecord) {
        this.#cancelledByUser.delete(id);
        return;
      }

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

      const userRejected = wantsUserRejected && latest.status !== "broadcast";

      const updated = await this.#service.transition({
        id,
        fromStatus: latest.status,
        toStatus: "failed",
        patch: { error, userRejected },
      });

      if (!updated) {
        // Status advanced concurrently. Reload and try again against the new state.
        continue;
      }

      this.#queued.delete(id);
      const { previous, next } = this.#view.commitRecord(updated);
      this.#tracking.stop(id);
      this.#tracking.handleTransition(previous, next);
      this.#cancelledByUser.delete(id);
      return;
    }
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
      await this.rejectTransaction(id, createMissingAdapterError(meta.namespace));
      return;
    }
    if (!adapter.receiptTracking) {
      await this.rejectTransaction(id, createReceiptTrackingUnsupportedError(meta.namespace));
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

      const signed = await adapter.signTransaction(buildSignContext(meta), prepared);

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

      const broadcast = await adapter.broadcastTransaction(buildPrepareContext(signedMeta), signed);

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

  async resumePending(params?: ResumePendingTransactionsOptions): Promise<void> {
    const includeSigning = params?.includeSigning ?? true;
    const skippedExecutionIds = new Set(params?.skipExecutionIds ?? []);

    // Warm cache first (best-effort).
    this.#view.requestSync();

    const approved = includeSigning ? await this.#listAllByStatus("approved") : [];
    const signed = includeSigning ? await this.#listAllByStatus("signed") : [];
    const broadcast = await this.#listAllByStatus("broadcast");

    if (includeSigning) {
      for (const record of [...approved, ...signed]) {
        if (skippedExecutionIds.has(record.id) && !this.#releasedRetainedExecutionIds.has(record.id)) {
          continue;
        }
        const meta = this.#view.commitRecord(record).next;
        this.#enqueue(meta.id);
      }
    }

    for (const record of broadcast) {
      const meta = this.#view.commitRecord(record).next;
      this.#tracking.resumeBroadcast(meta);
    }
  }

  markRetainedExecutionResumed(id: string) {
    this.#releasedRetainedExecutionIds.add(id);
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
    let cursor: ListTransactionsCursor | undefined;

    while (true) {
      const page = await this.#service.list({
        status,
        limit: 200,
        ...(cursor !== undefined ? { before: cursor } : {}),
      });
      if (page.length === 0) break;
      out.push(...page);
      const tail = page.at(-1);
      cursor = tail ? { createdAt: tail.createdAt, id: tail.id } : undefined;
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

  #createApprovalRequest(meta: TransactionMeta): TransactionApprovalRequestPayload {
    return {
      transactionId: meta.id,
      chainRef: meta.chainRef,
      origin: meta.origin,
      chain: this.#buildChainMetadata(meta),
      from: meta.from,
      request: cloneRequest(meta.request),
      warnings: cloneWarnings(meta.warnings),
      issues: cloneIssues(meta.issues),
    };
  }

  #buildChainMetadata(meta: TransactionMeta): TransactionApprovalChainMetadata | null {
    const resolved = this.#supportedChains.getChain(meta.chainRef)?.metadata ?? null;
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
