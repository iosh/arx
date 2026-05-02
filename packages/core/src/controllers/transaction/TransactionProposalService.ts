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
import { buildSendTransactionApprovalReview } from "./review/projector.js";
import { isProposalTerminal } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalChainMetadata,
  TransactionApprovalRequestHandoff,
  TransactionApprovalRequestPayload,
  TransactionApproveResult,
  TransactionController,
  TransactionError,
  TransactionProposalMeta,
  TransactionProposalView,
  TransactionRecordView,
  TransactionRequest,
} from "./types.js";
import {
  buildProposalStateContext,
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createTransactionSubmissionUnavailableError,
} from "./utils.js";

type TransactionProposalServiceDeps = {
  proposalStore: TransactionProposalStore;
  recordView: Pick<TransactionRecordViewStore, "getView" | "getOrLoadView">;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  supportedChains: Pick<SupportedChainsController, "getChain">;
  accounts: Pick<AccountController, "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create">;
  namespaces: NamespaceTransactions;
  prepare: TransactionPrepareManager;
  readTransactionTimestamp: () => number;
};

export class TransactionProposalService
  implements Pick<TransactionController, "getTransactionApprovalReview" | "retryPrepare" | "applyDraftEdit">
{
  #proposalStore: TransactionProposalStore;
  #recordView: Pick<TransactionRecordViewStore, "getView" | "getOrLoadView">;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef">;
  #supportedChains: Pick<SupportedChainsController, "getChain">;
  #accounts: Pick<AccountController, "listOwnedForNamespace">;
  #approvals: Pick<ApprovalController, "create">;
  #namespaces: NamespaceTransactions;
  #prepare: TransactionPrepareManager;
  #readTransactionTimestamp: () => number;

  constructor(deps: TransactionProposalServiceDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#recordView = deps.recordView;
    this.#accountCodecs = deps.accountCodecs;
    this.#networkSelection = deps.networkSelection;
    this.#supportedChains = deps.supportedChains;
    this.#accounts = deps.accounts;
    this.#approvals = deps.approvals;
    this.#namespaces = deps.namespaces;
    this.#prepare = deps.prepare;
    this.#readTransactionTimestamp = deps.readTransactionTimestamp;
  }

  getProposalView(id: string): TransactionProposalView | undefined {
    return this.#proposalStore.getView(id) ? this.#requireProposalView(id) : undefined;
  }

  getRecordView(id: string): TransactionRecordView | undefined {
    return this.#recordView.getView(id);
  }

  getTransactionApprovalReview(transactionId: string) {
    const proposalView = this.#proposalStore.getView(transactionId);
    const proposalMeta = proposalView ? this.#proposalStore.get(transactionId) : undefined;
    const namespaceTransaction = proposalMeta ? this.#namespaces.get(proposalMeta.namespace) : undefined;
    const reviewPreparedSnapshot = proposalView?.reviewState.reviewPreparedSnapshot ?? proposalMeta?.prepared ?? null;
    const namespaceReview =
      proposalMeta && namespaceTransaction
        ? (namespaceTransaction.proposal?.buildReview?.({
            ...buildProposalStateContext(proposalMeta),
            reviewPreparedSnapshot,
          }) ?? null)
        : null;

    return buildSendTransactionApprovalReview({
      updatedAt: proposalView?.reviewState.updatedAt ?? proposalMeta?.updatedAt ?? 0,
      review:
        proposalView?.reviewState.status && proposalView.reviewState.sessionToken
          ? {
              sessionToken: proposalView.reviewState.sessionToken,
              status: proposalView.reviewState.status,
              updatedAt: proposalView.reviewState.updatedAt,
              reviewPreparedSnapshot: proposalView.reviewState.reviewPreparedSnapshot,
              blocker: proposalView.reviewState.blocker,
              error: proposalView.reviewState.error,
              ...(proposalView.reviewState.invalidatedBy !== undefined
                ? { invalidatedBy: proposalView.reviewState.invalidatedBy }
                : {}),
            }
          : null,
      hasPrepared: Boolean(proposalMeta?.prepared),
      namespaceReview,
    });
  }

  async beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalRequestHandoff> {
    const namespaceActiveChainRef = this.#networkSelection.getSelectedChainRef(request.namespace);
    const chainRef = request.chainRef ?? namespaceActiveChainRef ?? null;
    if (!chainRef) {
      throw new Error("chainRef is required for transactions");
    }

    const derived = parseChainRef(chainRef);
    if (request.namespace !== derived.namespace) {
      throw new Error(`Transaction namespace mismatch: request=${request.namespace} chainRef=${chainRef}`);
    }

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
    namespaceTransaction.request?.validateRequest?.(validationContext);

    const id = crypto.randomUUID();
    const approvalId = crypto.randomUUID();
    const timestamp = this.#readTransactionTimestamp();

    const proposalMeta = this.#proposalStore.createPendingProposal({
      id,
      approvalId,
      createdAt: timestamp,
      namespace: derived.namespace,
      chainRef,
      origin: requestContext.origin,
      fromAccountKey,
      request: structuredClone(derivedRequest),
      updatedAt: timestamp,
    });

    const approvalRequest = this.#buildApprovalRequestPayload(proposalMeta, proposalMeta.id);
    let approvalHandle: ApprovalHandle<typeof ApprovalKinds.SendTransaction>;
    try {
      approvalHandle = options?.requestBinding
        ? options.requestBinding.attachBlockingApproval(
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
                    transactionId: proposalMeta.id,
                  },
                },
              ),
            {
              approvalId,
              createdAt: proposalMeta.createdAt,
            },
          )
        : requestApproval(
            { approvals: this.#approvals, now: this.#readTransactionTimestamp },
            {
              kind: ApprovalKinds.SendTransaction,
              requestContext,
              approvalId,
              createdAt: proposalMeta.createdAt,
              request: approvalRequest,
              subject: {
                kind: "transaction",
                transactionId: proposalMeta.id,
              },
            },
          );
    } catch (error) {
      const rejectionError = error instanceof Error ? error : new Error(String(error));
      this.#failProposal(proposalMeta.id, rejectionError);
      throw error;
    }

    // Keep the approval promise observed even if the caller only uses the
    // transaction/approval ids from the handoff.
    void approvalHandle.settled.catch(() => undefined);

    this.#prepare.queuePrepare(id);

    return {
      transactionId: proposalMeta.id,
      approvalId: approvalHandle.approvalId,
    };
  }

  async retryPrepare(transactionId: string): Promise<void> {
    const proposal = this.#proposalStore.peek(transactionId);
    if (!proposal || isProposalTerminal(proposal)) {
      return;
    }

    this.#prepare.queuePrepare(transactionId);
  }

  async applyDraftEdit(input: {
    transactionId: string;
    changes: ReadonlyArray<Record<string, unknown>>;
    mode?: string;
  }): Promise<void> {
    const meta = this.#proposalStore.get(input.transactionId);
    const proposal = this.#proposalStore.peek(input.transactionId);
    if (!meta || !proposal || isProposalTerminal(proposal)) {
      return;
    }
    if (proposal.phase !== "pending") {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction?.proposal?.applyDraftEdit) {
      throw new Error(`Transaction draft edits are not supported for namespace "${meta.namespace}".`);
    }

    const request = this.#requireRuntimeRequest(meta);
    const nextRequest = namespaceTransaction.proposal.applyDraftEdit({
      ...buildProposalStateContext(meta),
      request: structuredClone({
        ...request,
        chainRef: request.chainRef ?? meta.chainRef,
      }),
      changes: input.changes,
      ...(input.mode ? { mode: input.mode } : {}),
    });

    const edited = this.#proposalStore.replacePendingDraftRequest({
      id: meta.id,
      request: structuredClone(nextRequest),
      updatedAt: this.#readTransactionTimestamp(),
    });
    if (!edited) {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    await this.retryPrepare(meta.id);
  }

  approveForExecution(id: string): TransactionApproveResult {
    const existing = this.#requireProposalViewOrNull(id);
    if (!existing) {
      return {
        status: "failed",
        reason: "not_found",
        message: "Transaction not found.",
        data: { transactionId: id },
      };
    }
    const proposal = this.#proposalStore.peek(id);
    if (!proposal || proposal.phase !== "pending") {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: existing,
        message: "Transaction is no longer pending approval.",
        data: { transactionId: id, phase: proposal?.phase ?? existing.phase },
      };
    }

    const reviewState = this.#proposalStore.getView(id)?.reviewState ?? null;
    if (reviewState?.status === "blocked") {
      return {
        status: "failed",
        reason: "prepare_blocked",
        transaction: existing,
        message: reviewState.blocker?.message ?? "Transaction is blocked.",
        data: {
          transactionId: id,
          ...(reviewState.blocker ? { blocker: reviewState.blocker } : {}),
        },
      };
    }
    if (reviewState?.status === "failed" || reviewState?.status === "invalidated") {
      return {
        status: "failed",
        reason: "prepare_failed",
        transaction: existing,
        message: reviewState.error?.message ?? "Transaction preparation failed.",
        data: {
          transactionId: id,
          ...(reviewState.error ? { error: reviewState.error } : {}),
        },
      };
    }
    if (reviewState?.status && reviewState.status !== "ready") {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: id, prepareState: reviewState.status },
      };
    }
    if (!this.#proposalStore.hasCurrentPrepared(id)) {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: id },
      };
    }

    const updated = this.#proposalStore.approvePendingProposal({
      id,
      updatedAt: this.#readTransactionTimestamp(),
    });
    if (!updated) {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: this.#requireProposalViewOrNull(id) ?? undefined,
        message: "Transaction is no longer pending approval.",
        data: { transactionId: id },
      };
    }

    return { status: "approved", transaction: this.#requireProposalView(id) };
  }

  #failProposal(id: string, reason?: Error | TransactionError): void {
    const proposal = this.#proposalStore.peek(id);
    if (!proposal || isProposalTerminal(proposal)) {
      return;
    }

    this.#proposalStore.failProposal({
      id,
      updatedAt: this.#readTransactionTimestamp(),
      patch: {
        error: coerceTransactionError(reason) ?? null,
        userRejected: false,
      },
    });
  }

  invalidateFromApproval(event: ApprovalFinishedEvent<unknown>) {
    return this.#proposalStore.invalidateReviewFromApproval(event, this.#readTransactionTimestamp());
  }

  #buildApprovalRequestPayload(
    meta: TransactionProposalMeta | null,
    transactionId: string,
  ): TransactionApprovalRequestPayload {
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

  #requireRuntimeRequest(meta: TransactionProposalMeta): TransactionRequest {
    return meta.request;
  }

  #requireProposalView(id: string): TransactionProposalView {
    const proposal = this.#proposalStore.getView(id);
    if (!proposal) {
      throw new Error(`Transaction ${id} is not an active proposal`);
    }

    return {
      ...proposal,
      review: this.getTransactionApprovalReview(id),
    };
  }

  #requireProposalViewOrNull(id: string): TransactionProposalView | null {
    return this.#proposalStore.getView(id) ? this.#requireProposalView(id) : null;
  }

  #buildChainMetadata(meta: TransactionProposalMeta): TransactionApprovalChainMetadata | null {
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
