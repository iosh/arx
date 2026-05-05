import { ArxReasons, arxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { requestApproval } from "../../approvals/creation.js";
import { parseChainRef } from "../../chains/caip.js";
import type { AccountAddress, AccountController, OwnedAccountView } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { TransactionValidationContext } from "../../transactions/namespace/types.js";
import type { TransactionError, TransactionRequest } from "../../transactions/types.js";
import type { ApprovalController, ApprovalHandle } from "../approval/types.js";
import { ApprovalKinds } from "../approval/types.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";
import type { BeginTransactionApprovalOptions, TransactionApprovalRequestHandoff } from "./types.js";
import {
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createTransactionSubmissionUnavailableError,
} from "./utils.js";

type TransactionProposalBeginServiceDeps = {
  proposalStore: TransactionProposalStore;
  reviewSessions: TransactionReviewSessionStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  accounts: Pick<AccountController, "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create">;
  namespaces: NamespaceTransactions;
  prepare: Pick<TransactionPrepareManager, "queuePrepare">;
  readTransactionTimestamp: () => number;
};

export class TransactionProposalBeginService {
  #proposalStore: TransactionProposalStore;
  #reviewSessions: TransactionReviewSessionStore;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #accounts: Pick<AccountController, "listOwnedForNamespace">;
  #approvals: Pick<ApprovalController, "create">;
  #namespaces: NamespaceTransactions;
  #prepare: Pick<TransactionPrepareManager, "queuePrepare">;
  #readTransactionTimestamp: () => number;

  constructor(deps: TransactionProposalBeginServiceDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#reviewSessions = deps.reviewSessions;
    this.#accountCodecs = deps.accountCodecs;
    this.#accounts = deps.accounts;
    this.#approvals = deps.approvals;
    this.#namespaces = deps.namespaces;
    this.#prepare = deps.prepare;
    this.#readTransactionTimestamp = deps.readTransactionTimestamp;
  }

  async beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalRequestHandoff> {
    const derived = parseChainRef(request.chainRef);
    if (request.namespace !== derived.namespace) {
      throw new Error(`Transaction namespace mismatch: request=${request.namespace} chainRef=${request.chainRef}`);
    }

    const namespaceTransaction = this.#namespaces.get(derived.namespace);
    if (!namespaceTransaction) {
      throw createMissingNamespaceTransactionError(derived.namespace);
    }
    if (!namespaceTransaction.tracking) {
      throw createTransactionSubmissionUnavailableError({ namespace: derived.namespace, chainRef: request.chainRef });
    }

    const fromAccountKey = this.#accountCodecs.toAccountKeyFromAddress({
      chainRef: request.chainRef,
      address: options.from,
    });
    const derivedRequestCandidate =
      namespaceTransaction.request?.deriveForChain?.(request, request.chainRef) ?? request;
    if (derivedRequestCandidate.namespace !== derived.namespace) {
      throw new Error(
        `Namespace transaction derived request namespace mismatch: expected=${derived.namespace} actual=${derivedRequestCandidate.namespace}`,
      );
    }
    if (derivedRequestCandidate.chainRef !== request.chainRef) {
      throw new Error(
        `Namespace transaction derived request chainRef mismatch: expected=${request.chainRef} actual=${derivedRequestCandidate.chainRef}`,
      );
    }

    const derivedRequest: TransactionRequest = derivedRequestCandidate;
    const ownedAccount = this.#requireOwnedFromAccount({
      namespace: derived.namespace,
      chainRef: request.chainRef,
      fromAddress: options.from,
      fromAccountKey,
    });
    const validationContext: TransactionValidationContext = {
      namespace: derived.namespace,
      chainRef: request.chainRef,
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
      chainRef: request.chainRef,
      origin: requestContext.origin,
      fromAccountKey,
      request: structuredClone(derivedRequest),
      updatedAt: timestamp,
    });

    const approvalRequest = {
      transactionId: proposalMeta.id,
      chainRef: request.chainRef,
      origin: requestContext.origin,
    };
    this.#reviewSessions.reuseOrBeginPrepareSession({
      id,
      draftRevision: 0,
      updatedAt: timestamp,
    });

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

    void approvalHandle.settled.catch(() => undefined);
    this.#prepare.queuePrepare(id);

    return {
      transactionId: proposalMeta.id,
      approvalId: approvalHandle.approvalId,
    };
  }

  #failProposal(id: string, reason?: Error | TransactionError): void {
    const proposal = this.#proposalStore.peek(id);
    if (!proposal || proposal.phase === "failed") {
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
}
