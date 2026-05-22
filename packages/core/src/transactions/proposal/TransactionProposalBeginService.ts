import { ArxReasons, arxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { parseChainRef } from "../../chains/caip.js";
import type { AccountAddress, AccountController, OwnedAccountView } from "../../controllers/account/types.js";
import type { ApprovalController, ApprovalCreateParams, ApprovalRequester } from "../../controllers/approval/types.js";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import type { TransactionIntent } from "../intent/index.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { TransactionValidationContext } from "../namespace/types.js";
import type { TransactionProposalMeta } from "../proposal/types.js";
import type {
  BeginTransactionApprovalOptions,
  TransactionApprovalRequestRef,
  TransactionRequestBinding,
} from "../provider/types.js";
import type { TransactionCaller, TransactionRequest } from "../types.js";
import {
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createTransactionSubmissionUnavailableError,
} from "../utils.js";
import type { TransactionPrepare } from "./TransactionPrepare.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";

type TransactionProposalBeginServiceDeps = {
  proposalRuntime: TransactionProposalRuntime;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  accounts: Pick<AccountController, "listOwnedForNamespace">;
  approvals: Pick<ApprovalController, "create" | "createPending">;
  namespaces: NamespaceTransactions;
  prepare: Pick<TransactionPrepare, "queue">;
  now: () => number;
  logger?: (message: string, data?: unknown) => void;
};

export class TransactionProposalBeginService {
  #proposalRuntime: TransactionProposalRuntime;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #accounts: Pick<AccountController, "listOwnedForNamespace">;
  #approvals: Pick<ApprovalController, "create" | "createPending">;
  #namespaces: NamespaceTransactions;
  #prepare: Pick<TransactionPrepare, "queue">;
  #now: () => number;
  #logger: (message: string, data?: unknown) => void;

  constructor(deps: TransactionProposalBeginServiceDeps) {
    this.#proposalRuntime = deps.proposalRuntime;
    this.#accountCodecs = deps.accountCodecs;
    this.#accounts = deps.accounts;
    this.#approvals = deps.approvals;
    this.#namespaces = deps.namespaces;
    this.#prepare = deps.prepare;
    this.#now = deps.now;
    this.#logger = deps.logger ?? (() => {});
  }

  async beginTransactionApproval(
    intent: TransactionIntent,
    requester: ApprovalRequester,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalRequestRef> {
    const proposalMeta = this.createProposal(intent, requester);
    const approvalId = this.requestApproval(proposalMeta, requester, options.requestBinding ?? null);

    return {
      transactionId: proposalMeta.id,
      approvalId,
    };
  }

  createProposal(intent: TransactionIntent, caller: TransactionCaller): TransactionProposalMeta {
    const { request } = intent;
    const derived = parseChainRef(request.chainRef);
    if (request.namespace !== derived.namespace) {
      throw new Error(`Transaction namespace mismatch: request=${request.namespace} chainRef=${request.chainRef}`);
    }
    if (intent.namespace !== derived.namespace) {
      throw new Error(`Transaction intent namespace mismatch: intent=${intent.namespace} chainRef=${intent.chainRef}`);
    }
    if (intent.chainRef !== request.chainRef) {
      throw new Error(`Transaction intent chainRef mismatch: intent=${intent.chainRef} request=${request.chainRef}`);
    }

    const namespaceTransaction = this.#namespaces.get(derived.namespace);
    if (!namespaceTransaction) {
      throw createMissingNamespaceTransactionError(derived.namespace);
    }
    if (!namespaceTransaction.tracking) {
      throw createTransactionSubmissionUnavailableError({ namespace: derived.namespace, chainRef: request.chainRef });
    }

    const derivedAccountKey = this.#accountCodecs.toAccountKeyFromAddress({
      chainRef: request.chainRef,
      address: intent.account.accountAddress,
    });
    if (intent.account.accountKey !== derivedAccountKey) {
      throw new Error(
        `Transaction intent account mismatch: accountKey=${intent.account.accountKey} derived=${derivedAccountKey}`,
      );
    }
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
      accountAddress: intent.account.accountAddress,
      accountKey: intent.account.accountKey,
    });
    const validationContext: TransactionValidationContext = {
      namespace: derived.namespace,
      chainRef: request.chainRef,
      origin: caller.origin,
      from: ownedAccount.canonicalAddress,
      request: structuredClone(derivedRequest),
    };
    namespaceTransaction.request?.validateRequest?.(validationContext);

    const timestamp = this.#now();
    const proposalMeta = this.#proposalRuntime.createPendingProposal({
      id: crypto.randomUUID(),
      approvalId: crypto.randomUUID(),
      createdAt: timestamp,
      namespace: derived.namespace,
      chainRef: request.chainRef,
      origin: caller.origin,
      fromAccountKey: ownedAccount.accountKey,
      requestedAddress: intent.account.requestedAddress ?? null,
      request: structuredClone(derivedRequest),
      updatedAt: timestamp,
    });

    this.#prepare.queue(proposalMeta.id);
    return proposalMeta;
  }

  requestApproval(
    proposalMeta: TransactionProposalMeta,
    requester: ApprovalRequester,
    requestBinding?: TransactionRequestBinding | null,
  ): string {
    if (requester.origin !== proposalMeta.origin) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Transaction approval requester origin must match the proposal origin.",
        data: {
          transactionId: proposalMeta.id,
          proposalOrigin: proposalMeta.origin,
          requesterOrigin: requester.origin,
        },
      });
    }

    const createApprovalParams = (
      approvalId: string,
      createdAt: number,
    ): ApprovalCreateParams<typeof ApprovalKinds.SendTransaction> => ({
      approvalId,
      kind: ApprovalKinds.SendTransaction,
      origin: proposalMeta.origin,
      namespace: proposalMeta.namespace,
      chainRef: proposalMeta.chainRef,
      createdAt,
      request: {
        transactionId: proposalMeta.id,
        chainRef: proposalMeta.chainRef,
        origin: proposalMeta.origin,
      },
      subject: {
        kind: "transaction",
        transactionId: proposalMeta.id,
      },
    });

    try {
      if (requestBinding) {
        return requestBinding.attachBlockingApproval(
          ({ approvalId, createdAt }) => {
            this.#approvals.createPending(createApprovalParams(approvalId, createdAt), requester);
            return {};
          },
          {
            approvalId: proposalMeta.approvalId,
            createdAt: proposalMeta.createdAt,
          },
        ).approvalId;
      }

      this.#approvals.createPending(createApprovalParams(proposalMeta.approvalId, proposalMeta.createdAt), requester);
      return proposalMeta.approvalId;
    } catch (error) {
      const approvalError = error instanceof Error ? error : new Error(String(error));
      const failed = this.#proposalRuntime.failProposal({
        id: proposalMeta.id,
        updatedAt: this.#now(),
        error: coerceTransactionError(approvalError) ?? null,
        terminationReason: "internal_error",
      });
      if (failed.status !== "failed") {
        throw new Error(`Failed to mark proposal ${proposalMeta.id} as failed after approval creation error.`);
      }
      throw error;
    }
  }

  #requireOwnedFromAccount(params: {
    namespace: string;
    chainRef: string;
    accountAddress: AccountAddress;
    accountKey: string;
  }): OwnedAccountView {
    const { namespace, chainRef, accountAddress, accountKey } = params;
    const ownedAccount = this.#accounts.listOwnedForNamespace({ namespace, chainRef }).find((account) => {
      return account.accountKey === accountKey;
    });
    if (ownedAccount) {
      if (ownedAccount.canonicalAddress !== accountAddress) {
        throw new Error(
          `Transaction intent account address mismatch: accountKey=${accountKey} expected=${ownedAccount.canonicalAddress} actual=${accountAddress}`,
        );
      }
      return ownedAccount;
    }

    throw arxError({
      reason: ArxReasons.PermissionDenied,
      message: "Requested from address is not available in this wallet.",
      data: { from: accountAddress, chainRef },
    });
  }
}
