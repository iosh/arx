import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { requestApproval } from "../../approvals/creation.js";
import { parseChainRef } from "../../chains/caip.js";
import type { AccountController, OwnedAccountView } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { TransactionValidationContext } from "../../transactions/namespace/types.js";
import type { ApprovalController, ApprovalHandle } from "../approval/types.js";
import { ApprovalKinds } from "../approval/types.js";
import type { SupportedChainsController } from "../supportedChains/types.js";
import type { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import type { TransactionReviewSessions } from "./review/session.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isExecutableTransactionStatus, isTerminalTransactionStatus } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalChainMetadata,
  TransactionApprovalHandoff,
  TransactionApprovalRequestPayload,
  TransactionController,
  TransactionError,
  TransactionMeta,
  TransactionRequest,
} from "./types.js";
import {
  buildPrepareContext,
  buildSignContext,
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createReceiptTrackingUnsupportedError,
  createTransactionSubmissionUnavailableError,
  isUserRejectedError,
} from "./utils.js";

const DEFAULT_PREPARE_TIMEOUT_MS = 20_000;

type Deps = {
  runtime: RuntimeTransactionStore;
  view: StoreTransactionView;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  supportedChains: Pick<SupportedChainsController, "getChain">;
  accounts: Pick<AccountController, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  prepare: TransactionPrepareManager;
  reviewSessions: TransactionReviewSessions;
  tracking: TransactionReceiptTracking;
  now: () => number;
};

export class TransactionExecutor
  implements
    Pick<
      TransactionController,
      "beginTransactionApproval" | "approveTransaction" | "rejectTransaction" | "processTransaction" | "resumePending"
    >
{
  #runtime: RuntimeTransactionStore;
  #view: StoreTransactionView;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  #supportedChains: Pick<SupportedChainsController, "getChain">;
  #accounts: Pick<AccountController, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  #approvals: Pick<ApprovalController, "create">;
  #namespaces: NamespaceTransactions;
  #service: TransactionsService;
  #prepare: TransactionPrepareManager;
  #reviewSessions: TransactionReviewSessions;
  #tracking: TransactionReceiptTracking;
  #now: () => number;
  #lastTimestamp = 0;

  #queue: string[] = [];
  #queued = new Set<string>();
  #processing = new Set<string>();
  #scheduled = false;
  #cancelledByUser = new Set<string>();
  #broadcasting = new Set<string>();

  constructor(deps: Deps) {
    this.#runtime = deps.runtime;
    this.#view = deps.view;
    this.#accountCodecs = deps.accountCodecs;
    this.#networkSelection = deps.networkSelection;
    this.#supportedChains = deps.supportedChains;
    this.#accounts = deps.accounts;
    this.#approvals = deps.approvals;
    this.#namespaces = deps.namespaces;
    this.#service = deps.service;
    this.#prepare = deps.prepare;
    this.#reviewSessions = deps.reviewSessions;
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
    const namespaceTransaction = this.#namespaces.get(derived.namespace);
    if (namespaceTransaction && !namespaceTransaction.receiptTracking) {
      throw createTransactionSubmissionUnavailableError({ namespace: derived.namespace, chainRef });
    }
    if (!namespaceTransaction) {
      throw createMissingNamespaceTransactionError(derived.namespace);
    }

    const derivedRequestCandidate = namespaceTransaction.deriveRequestForChain?.(request, chainRef) ?? {
      ...request,
      chainRef,
    };
    if (derivedRequestCandidate.namespace !== derived.namespace) {
      throw new Error(
        `Namespace transaction derived request namespace mismatch: expected=${derived.namespace} actual=${derivedRequestCandidate.namespace}`,
      );
    }
    if (derivedRequestCandidate.chainRef !== undefined && derivedRequestCandidate.chainRef !== chainRef) {
      throw new Error(
        `Namespace transaction derived request chainRef mismatch: expected=${chainRef} actual=${derivedRequestCandidate.chainRef}`,
      );
    }

    const derivedRequest: TransactionRequest = {
      ...derivedRequestCandidate,
      chainRef,
    };
    const ownedAccount = this.#requireOwnedFromAccount({
      namespace: derived.namespace,
      chainRef,
      fromAddress,
      fromAccountKey,
    });
    const validationContext: TransactionValidationContext = {
      namespace: derived.namespace,
      chainRef,
      origin: requestContext.origin,
      from: ownedAccount.canonicalAddress,
      request: structuredClone(derivedRequest),
    };
    namespaceTransaction.validateRequest?.(validationContext);

    const runtimeMeta = this.#runtime.create({
      id,
      createdAt: timestamp,
      namespace: derived.namespace,
      chainRef,
      origin: requestContext.origin,
      fromAccountKey,
      request: structuredClone(derivedRequest),
      status: "pending",
      updatedAt: timestamp,
    });

    const approvalRequest = this.buildApprovalRequestPayload(runtimeMeta, runtimeMeta.id);
    const approvalId = crypto.randomUUID();
    let approvalHandle: ApprovalHandle<typeof ApprovalKinds.SendTransaction>;
    try {
      approvalHandle = options?.providerRequestHandle
        ? options.providerRequestHandle.attachBlockingApproval(
            ({ approvalId: reservedApprovalId, createdAt }) =>
              requestApproval(
                { approvals: this.#approvals, now: this.#now },
                {
                  kind: ApprovalKinds.SendTransaction,
                  requestContext,
                  approvalId: reservedApprovalId,
                  createdAt,
                  request: approvalRequest,
                  subject: {
                    kind: "transaction",
                    transactionId: runtimeMeta.id,
                  },
                },
              ),
            {
              approvalId,
              createdAt: runtimeMeta.createdAt,
            },
          )
        : requestApproval(
            { approvals: this.#approvals, now: this.#now },
            {
              kind: ApprovalKinds.SendTransaction,
              requestContext,
              approvalId,
              createdAt: runtimeMeta.createdAt,
              request: approvalRequest,
              subject: {
                kind: "transaction",
                transactionId: runtimeMeta.id,
              },
            },
          );
    } catch (error) {
      const rejectionError = error instanceof Error ? error : new Error(String(error));
      await this.rejectTransaction(runtimeMeta.id, rejectionError);
      throw error;
    }

    this.#prepare.queuePrepare(id);

    return {
      transactionId: runtimeMeta.id,
      approvalId: approvalHandle.approvalId,
      pendingMeta: runtimeMeta,
      waitForApprovalDecision: async () => {
        await approvalHandle.settled;
        const next = this.#runtime.get(id) ?? this.#view.getMeta(id) ?? (await this.#view.getOrLoad(id));
        if (!next) {
          throw new Error(`Transaction ${id} is no longer active`);
        }
        return next;
      },
    };
  }

  async approveTransaction(id: string): Promise<TransactionMeta | null> {
    const existing = this.#runtime.get(id) ?? null;
    if (!existing || existing.status !== "pending") {
      return null;
    }

    const updated = this.#runtime.transition({
      id,
      fromStatus: "pending",
      toStatus: "approved",
      updatedAt: this.#nextTimestamp(),
    });
    if (!updated) {
      return null;
    }

    this.#enqueue(id);
    return updated;
  }

  async rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    const error = coerceTransactionError(reason) ?? null;
    const wantsUserRejected = isUserRejectedError(reason, error ?? undefined);
    if (wantsUserRejected) {
      this.#cancelledByUser.add(id);
    }

    const runtime = this.#runtime.get(id);
    if (runtime && !isTerminalTransactionStatus(runtime.status)) {
      this.#queued.delete(id);
      if (runtime.status === "broadcast" || this.#broadcasting.has(id)) {
        this.#cancelledByUser.delete(id);
        return;
      }
      this.#runtime.transition({
        id,
        fromStatus: ["pending", "approved", "signed"],
        toStatus: "failed",
        updatedAt: this.#nextTimestamp(),
        patch: {
          error,
          userRejected: wantsUserRejected,
        },
      });
      this.#cancelledByUser.delete(id);
      return;
    }

    const latestRecord = await this.#service.get(id);
    if (!latestRecord) {
      this.#cancelledByUser.delete(id);
      return;
    }

    const latest = this.#view.commitRecord(latestRecord).next;
    if (
      latest.status !== "broadcast" &&
      latest.status !== "confirmed" &&
      latest.status !== "failed" &&
      latest.status !== "replaced"
    ) {
      this.#cancelledByUser.delete(id);
      return;
    }
    if (latest.status === "broadcast" && wantsUserRejected) {
      this.#cancelledByUser.delete(id);
      return;
    }
    if (isTerminalTransactionStatus(latest.status)) {
      this.#cancelledByUser.delete(id);
      return;
    }

    const updated = await this.#service.transition({
      id,
      fromStatus: latest.status,
      toStatus: "failed",
    });
    if (updated) {
      const { previous, next } = this.#view.commitRecord(updated);
      this.#tracking.stop(id);
      this.#tracking.handleTransition(previous, next);
    }
    this.#cancelledByUser.delete(id);
  }

  async processTransaction(id: string): Promise<void> {
    if (this.#isCancelled(id)) {
      return;
    }

    let meta = this.#runtime.get(id);
    if (!meta || !isExecutableTransactionStatus(meta.status)) {
      return;
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      await this.rejectTransaction(id, createMissingNamespaceTransactionError(meta.namespace));
      return;
    }
    if (!namespaceTransaction.receiptTracking) {
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

      const signed = await namespaceTransaction.signTransaction(buildSignContext(meta), prepared);
      const signedMeta = this.#runtime.transition({
        id,
        fromStatus: meta.status,
        toStatus: "signed",
        updatedAt: this.#nextTimestamp(),
      });
      if (!signedMeta) {
        return;
      }

      if (this.#isCancelled(id)) {
        return;
      }

      this.#broadcasting.add(id);
      let broadcast;
      try {
        broadcast = await namespaceTransaction.broadcastTransaction(buildPrepareContext(signedMeta), signed, prepared);
      } finally {
        this.#broadcasting.delete(id);
      }
      const broadcastMeta = this.#runtime.transition({
        id,
        fromStatus: "signed",
        toStatus: "broadcast",
        updatedAt: this.#nextTimestamp(),
        patch: {
          submitted: structuredClone(broadcast.submitted),
          locator: structuredClone(broadcast.locator),
        },
      });
      if (!broadcastMeta) {
        return;
      }

      let durable;
      try {
        durable = await this.#service.createSubmitted({
          id: broadcastMeta.id,
          createdAt: broadcastMeta.createdAt,
          chainRef: broadcastMeta.chainRef,
          origin: broadcastMeta.origin,
          fromAccountKey: this.#accountCodecs.toAccountKeyFromAddress({
            chainRef: broadcastMeta.chainRef,
            address: this.#requireFromAddress(broadcastMeta),
          }),
          status: "broadcast",
          submitted: structuredClone(broadcast.submitted),
          locator: structuredClone(broadcast.locator),
        });
      } catch (error) {
        const persistenceFailure = error instanceof Error ? error : new Error("Transaction persistence failed");
        this.#runtime.transition({
          id,
          fromStatus: "broadcast",
          toStatus: "failed",
          updatedAt: this.#nextTimestamp(),
          patch: {
            error: coerceTransactionError(persistenceFailure) ?? {
              name: "TransactionPersistenceError",
              message: "Transaction was broadcast but could not be persisted locally.",
            },
          },
        });
        return;
      }

      this.#runtime.markDurablySubmitted(id);

      const { previous, next } = this.#view.commitRecord(durable);
      this.#tracking.handleTransition(previous, next);
    } catch (err) {
      if (err && isArxError(err) && err.reason === ArxReasons.SessionLocked) {
        this.#runtime.resetSignedToApproved(id, this.#nextTimestamp());
        return;
      }
      await this.rejectTransaction(id, err instanceof Error ? err : new Error("Transaction processing failed"));
    }
  }

  async resumePending(): Promise<void> {
    this.#view.requestSync();
    for (const runtimeId of this.#runtime.listExecutableIds()) {
      this.#enqueue(runtimeId);
    }

    const broadcast = await this.#listAllByStatus("broadcast");
    for (const record of broadcast) {
      const meta = this.#view.commitRecord(record).next;
      this.#tracking.resumeBroadcast(meta);
    }
  }

  async retryPrepare(transactionId: string): Promise<void> {
    const meta = this.#runtime.get(transactionId);
    if (!meta || isTerminalTransactionStatus(meta.status)) {
      return;
    }

    this.#prepare.queuePrepare(transactionId);
  }

  async applyDraftEdit(input: {
    transactionId: string;
    changes: Record<string, unknown>[];
    mode?: string | undefined;
  }): Promise<void> {
    const meta = this.#runtime.get(input.transactionId);
    if (!meta || isTerminalTransactionStatus(meta.status)) {
      return;
    }
    if (meta.status !== "pending") {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction?.applyDraftEdit) {
      throw new Error(`Transaction draft edits are not supported for namespace "${meta.namespace}".`);
    }

    const request = this.#requireRuntimeRequest(meta);
    const nextRequest = namespaceTransaction.applyDraftEdit({
      transaction: meta,
      request: structuredClone({
        ...request,
        chainRef: request.chainRef ?? meta.chainRef,
      }),
      changes: input.changes,
      ...(input.mode ? { mode: input.mode } : {}),
    });

    const edited = this.#runtime.replaceDraftRequest({
      id: meta.id,
      fromStatus: "pending",
      request: structuredClone(nextRequest),
      updatedAt: this.#nextTimestamp(),
    });
    if (!edited) {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    await this.retryPrepare(meta.id);
  }

  buildApprovalRequestPayload(meta: TransactionMeta | null, transactionId: string): TransactionApprovalRequestPayload {
    if (!meta) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    const request = this.#requireRuntimeRequest(meta);
    return {
      chainRef: meta.chainRef,
      origin: meta.origin,
      chain: this.#buildChainMetadata(meta),
      from: meta.from,
      request: structuredClone(request),
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
    if (this.#processing.has(next)) {
      this.#scheduleProcess();
      return;
    }
    this.#processing.add(next);
    try {
      await this.processTransaction(next);
    } finally {
      this.#processing.delete(next);
      if (this.#queue.length > 0) {
        this.#scheduleProcess();
      }
    }
  }

  #isCancelled(id: string): boolean {
    return this.#cancelledByUser.has(id);
  }

  async #listAllByStatus(status: "broadcast" | "confirmed" | "failed" | "replaced") {
    const out = [];
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

  #nextTimestamp(): number {
    const value = this.#now();
    if (value <= this.#lastTimestamp) {
      this.#lastTimestamp += 1;
      return this.#lastTimestamp;
    }
    this.#lastTimestamp = value;
    return value;
  }

  #findFromAddress(request: TransactionRequest | null | undefined): string | null {
    if (!request) {
      return null;
    }

    const payload = request.payload;
    if (payload && typeof payload === "object") {
      const candidate = (payload as { from?: unknown }).from;
      if (typeof candidate === "string") {
        return candidate;
      }
    }
    return null;
  }

  #requireRuntimeRequest(meta: TransactionMeta): TransactionRequest {
    if (meta.request) {
      return meta.request;
    }

    throw new Error(`Transaction ${meta.id} no longer has an editable runtime request.`);
  }

  #requireFromAddress(meta: TransactionMeta): string {
    const fromAddress = meta.from ?? this.#findFromAddress(meta.request);
    if (fromAddress) {
      return fromAddress;
    }

    throw new Error(`Transaction ${meta.id} is missing a from address.`);
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
