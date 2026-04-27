import { ArxReasons, arxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { requestApproval } from "../../approvals/creation.js";
import { parseChainRef } from "../../chains/caip.js";
import type { AccountAddress, AccountController, OwnedAccountView } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { TransactionValidationContext } from "../../transactions/namespace/types.js";
import type { ApprovalController, ApprovalFinishedEvent, ApprovalHandle } from "../approval/types.js";
import { ApprovalKinds } from "../approval/types.js";
import type { SupportedChainsController } from "../supportedChains/types.js";
import type { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import { buildSendTransactionApprovalReview } from "./review/projector.js";
import type { TransactionReviewSessions } from "./review/session.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isTerminalTransactionStatus } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalChainMetadata,
  TransactionApprovalHandoff,
  TransactionApprovalRequestPayload,
  TransactionApproveResult,
  TransactionController,
  TransactionError,
  TransactionMeta,
  TransactionRequest,
} from "./types.js";
import {
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createTransactionSubmissionUnavailableError,
} from "./utils.js";

type TransactionProposalServiceDeps = {
  runtime: RuntimeTransactionStore;
  view: Pick<StoreTransactionView, "getMeta" | "getOrLoad">;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  supportedChains: Pick<SupportedChainsController, "getChain">;
  accounts: Pick<AccountController, "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create">;
  namespaces: NamespaceTransactions;
  prepare: TransactionPrepareManager;
  reviewSessions: TransactionReviewSessions;
  readTransactionTimestamp: () => number;
};

export class TransactionProposalService
  implements
    Pick<
      TransactionController,
      "getMeta" | "getApprovalReview" | "beginTransactionApproval" | "retryPrepare" | "applyDraftEdit"
    >
{
  #runtime: RuntimeTransactionStore;
  #view: Pick<StoreTransactionView, "getMeta" | "getOrLoad">;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  #supportedChains: Pick<SupportedChainsController, "getChain">;
  #accounts: Pick<AccountController, "listOwnedForNamespace">;
  #approvals: Pick<ApprovalController, "create">;
  #namespaces: NamespaceTransactions;
  #prepare: TransactionPrepareManager;
  #reviewSessions: TransactionReviewSessions;
  #readTransactionTimestamp: () => number;

  constructor(deps: TransactionProposalServiceDeps) {
    this.#runtime = deps.runtime;
    this.#view = deps.view;
    this.#accountCodecs = deps.accountCodecs;
    this.#networkSelection = deps.networkSelection;
    this.#supportedChains = deps.supportedChains;
    this.#accounts = deps.accounts;
    this.#approvals = deps.approvals;
    this.#namespaces = deps.namespaces;
    this.#prepare = deps.prepare;
    this.#reviewSessions = deps.reviewSessions;
    this.#readTransactionTimestamp = deps.readTransactionTimestamp;
  }

  getMeta(id: string): TransactionMeta | undefined {
    return this.#runtime.get(id) ?? this.#view.getMeta(id);
  }

  getApprovalReview(input: Parameters<TransactionController["getApprovalReview"]>[0]) {
    const transaction = this.getMeta(input.transactionId);
    const session = this.#reviewSessions.get(input.transactionId);
    const request =
      input.request ?? (transaction ? this.#buildApprovalRequestPayload(transaction, input.transactionId) : null);
    const namespace = transaction?.namespace ?? request?.request.namespace;
    const namespaceTransaction = namespace ? this.#namespaces.get(namespace) : undefined;
    const reviewPreparedSnapshot = session ? session.reviewPreparedSnapshot : (transaction?.prepared ?? null);
    const namespaceReview =
      namespaceTransaction && request
        ? (namespaceTransaction.proposal?.buildReview?.({
            transaction,
            request,
            reviewPreparedSnapshot,
          }) ?? null)
        : null;

    return buildSendTransactionApprovalReview({
      transaction,
      session,
      namespaceReview,
    });
  }

  async beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
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
    const timestamp = this.#readTransactionTimestamp();

    const namespaceTransaction = this.#namespaces.get(derived.namespace);
    if (!namespaceTransaction) {
      throw createMissingNamespaceTransactionError(derived.namespace);
    }
    if (!namespaceTransaction.tracking) {
      throw createTransactionSubmissionUnavailableError({ namespace: derived.namespace, chainRef });
    }

    const fromAccountKey = this.#accountCodecs.toAccountKeyFromAddress({ chainRef, address: options.from });

    const derivedRequestCandidate = namespaceTransaction.request?.deriveForChain?.(request, chainRef) ?? {
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
      fromAddress: options.from,
      fromAccountKey,
    });
    const validationContext: TransactionValidationContext = {
      namespace: derived.namespace,
      chainRef,
      origin: requestContext.origin,
      from: ownedAccount.canonicalAddress,
      request: structuredClone(derivedRequest),
    };
    namespaceTransaction.request?.validate?.(validationContext);

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

    const approvalRequest = this.#buildApprovalRequestPayload(runtimeMeta, runtimeMeta.id);
    const approvalId = crypto.randomUUID();
    let approvalHandle: ApprovalHandle<typeof ApprovalKinds.SendTransaction>;
    try {
      approvalHandle = options?.providerRequestHandle
        ? options.providerRequestHandle.attachBlockingApproval(
            ({ approvalId: reservedApprovalId, createdAt }) =>
              requestApproval(
                { approvals: this.#approvals, now: this.#readTransactionTimestamp },
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
            { approvals: this.#approvals, now: this.#readTransactionTimestamp },
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
      this.#failRuntimeProposal(runtimeMeta.id, rejectionError);
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

  async retryPrepare(transactionId: string): Promise<void> {
    const meta = this.#runtime.get(transactionId);
    if (!meta || isTerminalTransactionStatus(meta.status)) {
      return;
    }

    this.#prepare.queuePrepare(transactionId);
  }

  async applyDraftEdit(input: {
    transactionId: string;
    changes: ReadonlyArray<Record<string, unknown>>;
    mode?: string;
  }): Promise<void> {
    const meta = this.#runtime.get(input.transactionId);
    if (!meta || isTerminalTransactionStatus(meta.status)) {
      return;
    }
    if (meta.status !== "pending") {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction?.proposal?.applyDraftEdit) {
      throw new Error(`Transaction draft edits are not supported for namespace "${meta.namespace}".`);
    }

    const request = this.#requireRuntimeRequest(meta);
    const nextRequest = namespaceTransaction.proposal.applyDraftEdit({
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
      updatedAt: this.#readTransactionTimestamp(),
    });
    if (!edited) {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    await this.retryPrepare(meta.id);
  }

  approveForExecution(id: string): TransactionApproveResult {
    const existing = this.#runtime.get(id) ?? null;
    if (!existing) {
      return {
        status: "failed",
        reason: "not_found",
        message: "Transaction not found.",
        data: { transactionId: id },
      };
    }
    if (existing.status !== "pending") {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: existing,
        message: "Transaction is no longer pending approval.",
        data: { transactionId: id, status: existing.status },
      };
    }

    const review = this.#reviewSessions.get(id);
    if (review?.status === "blocked") {
      return {
        status: "failed",
        reason: "prepare_blocked",
        transaction: existing,
        message: review.blocker?.message ?? "Transaction is blocked.",
        data: {
          transactionId: id,
          ...(review.blocker ? { blocker: review.blocker } : {}),
        },
      };
    }
    if (review?.status === "failed") {
      return {
        status: "failed",
        reason: "prepare_failed",
        transaction: existing,
        message: review.error?.message ?? "Transaction preparation failed.",
        data: {
          transactionId: id,
          ...(review.error ? { error: review.error } : {}),
        },
      };
    }
    if (review && review.status !== "ready") {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: id, prepareState: review.status },
      };
    }
    if (!this.#runtime.hasCurrentPrepared(id)) {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: id },
      };
    }

    const updated = this.#runtime.transition({
      id,
      fromStatus: "pending",
      toStatus: "approved",
      updatedAt: this.#readTransactionTimestamp(),
    });
    if (!updated) {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: this.#runtime.get(id),
        message: "Transaction is no longer pending approval.",
        data: { transactionId: id },
      };
    }

    return { status: "approved", transaction: updated };
  }

  #failRuntimeProposal(id: string, reason?: Error | TransactionError): void {
    const runtime = this.#runtime.get(id);
    if (!runtime || isTerminalTransactionStatus(runtime.status)) {
      return;
    }

    this.#runtime.transition({
      id,
      fromStatus: ["pending", "approved", "signed"],
      toStatus: "failed",
      updatedAt: this.#readTransactionTimestamp(),
      patch: {
        error: coerceTransactionError(reason) ?? null,
        userRejected: false,
      },
    });
  }

  invalidateFromApproval(event: ApprovalFinishedEvent<unknown>) {
    return this.#reviewSessions.invalidateFromApproval(event, this.#readTransactionTimestamp());
  }

  deleteReviewSession(transactionId: string): boolean {
    return this.#reviewSessions.delete(transactionId);
  }

  #buildApprovalRequestPayload(meta: TransactionMeta | null, transactionId: string): TransactionApprovalRequestPayload {
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
    fromAddress: AccountAddress;
    fromAccountKey: string;
  }): OwnedAccountView {
    const { namespace, chainRef, fromAddress, fromAccountKey } = params;
    const ownedAccount = this.#accounts.listOwnedForNamespace({ namespace, chainRef }).find((account) => {
      return account.accountKey === fromAccountKey;
    });
    if (ownedAccount) {
      return ownedAccount;
    }

    throw arxError({
      reason: ArxReasons.PermissionDenied,
      message: "Requested from address is not available in this wallet.",
      data: { from: fromAddress, chainRef },
    });
  }

  #requireRuntimeRequest(meta: TransactionMeta): TransactionRequest {
    if (meta.request) {
      return meta.request;
    }

    throw new Error(`Transaction ${meta.id} no longer has an editable runtime request.`);
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
