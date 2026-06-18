import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { isArxBaseError } from "../../error.js";
import type { JsonValue, TransactionAggregate, TransactionTerminalReason } from "../aggregate/index.js";
import { buildTransactionTerminalReason, type TransactionAggregateStore } from "../aggregate/index.js";
import { deriveApprovalResourceKeyFromAggregate } from "../approvalResourceKeys.js";
import { buildBroadcastArtifactContext, buildBroadcastContext } from "../broadcastContexts.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../namespace/operations.js";
import type { BroadcastArtifact, BroadcastResult, NamespaceTransactionSubmission } from "../namespace/types.js";
import type { TransactionResourceLock } from "../TransactionResourceLock.js";
import {
  TransactionAcceptanceCommitError,
  TransactionSubmissionActiveSubmissionMissingError,
  TransactionSubmissionNotSubmittableError,
  TransactionSubmissionTransactionNotFoundError,
} from "./errors.js";

type TransactionSubmissionExecutorDeps = {
  transactions: Pick<
    TransactionAggregateStore,
    | "loadTransactionAggregate"
    | "beginSubmissionSigning"
    | "queueSubmissionBroadcast"
    | "recordBroadcastAcceptance"
    | "failSubmission"
  >;
  namespaces: Pick<NamespaceTransactions, "require">;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  resourceLock: TransactionResourceLock;
};

export type TransactionSubmissionResult = {
  aggregate: TransactionAggregate;
  broadcastArtifact: BroadcastArtifact;
};

export class TransactionSubmissionExecutor {
  #transactions: Pick<
    TransactionAggregateStore,
    | "loadTransactionAggregate"
    | "beginSubmissionSigning"
    | "queueSubmissionBroadcast"
    | "recordBroadcastAcceptance"
    | "failSubmission"
  >;
  #namespaces: Pick<NamespaceTransactions, "require">;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #resourceLock: TransactionResourceLock;

  constructor(deps: TransactionSubmissionExecutorDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accountCodecs = deps.accountCodecs;
    this.#resourceLock = deps.resourceLock;
  }

  /**
   * Flow:
   * queued -> signing(createBroadcastArtifact) -> broadcasting(broadcast) -> accepted/submitted
   *                                         \-> failed
   *                            broadcast    \-> failed
   */
  async submitApprovedTransaction(transactionId: string): Promise<TransactionSubmissionResult> {
    const current = await this.#loadSubmittingAggregate(transactionId);
    const submissionId = this.#requireActiveSubmissionId(current);
    const namespaceTransaction = this.#namespaces.require(current.record.namespace);
    const submission = requireNamespaceTransactionOperation<NamespaceTransactionSubmission>({
      namespace: current.record.namespace,
      operation: "submission.createBroadcastArtifact",
      value: namespaceTransaction.submission,
    });

    const signing = await this.#transactions.beginSubmissionSigning({
      transactionId: current.record.id,
      submissionId,
    });

    let broadcastArtifact: BroadcastArtifact;
    try {
      broadcastArtifact = await submission.createBroadcastArtifact(
        buildBroadcastArtifactContext(signing, this.#accountCodecs),
      );
    } catch (error) {
      await this.#failSubmissionWithResourceLock({
        aggregate: current,
        submissionId,
        reason: this.#buildFailureReason({
          error,
          phase: "create_broadcast_artifact",
          namespace: signing.record.namespace,
        }),
      });
      throw error;
    }

    const broadcasting = await this.#transactions.queueSubmissionBroadcast({
      transactionId: current.record.id,
      submissionId,
    });

    let broadcastResult: BroadcastResult;
    try {
      const broadcast = requireNamespaceTransactionOperation({
        namespace: broadcasting.record.namespace,
        operation: "submission.broadcast",
        value: namespaceTransaction.submission?.broadcast,
      });
      broadcastResult = await broadcast(buildBroadcastContext(broadcasting, broadcastArtifact, this.#accountCodecs));
    } catch (error) {
      await this.#failSubmissionWithResourceLock({
        aggregate: current,
        submissionId,
        reason: this.#buildFailureReason({
          error,
          phase: "broadcast",
          namespace: broadcasting.record.namespace,
        }),
      });
      throw error;
    }

    try {
      const accepted = await this.#transactions.recordBroadcastAcceptance({
        transactionId: current.record.id,
        submissionId,
        submitted: broadcastResult.submitted as never,
      });

      return {
        aggregate: accepted,
        broadcastArtifact,
      };
    } catch (error) {
      throw new TransactionAcceptanceCommitError({
        transactionId: current.record.id,
        submissionId,
        broadcastIdentity: broadcastResult.broadcastIdentity as JsonValue,
        submitted: broadcastResult.submitted as JsonValue,
        cause: error,
      });
    }
  }

  async #loadSubmittingAggregate(transactionId: string) {
    const aggregate = await this.#transactions.loadTransactionAggregate(transactionId);
    if (!aggregate) {
      throw new TransactionSubmissionTransactionNotFoundError(transactionId);
    }
    if (aggregate.record.status !== "submitting") {
      throw new TransactionSubmissionNotSubmittableError({
        transactionId,
        status: aggregate.record.status,
      });
    }
    return aggregate;
  }

  #requireActiveSubmissionId(aggregate: TransactionAggregate) {
    const submissionId = aggregate.record.activeSubmissionId;
    if (!submissionId) {
      throw new TransactionSubmissionActiveSubmissionMissingError(aggregate.record.id);
    }
    return submissionId;
  }

  async #failSubmissionWithResourceLock(params: {
    aggregate: TransactionAggregate;
    submissionId: string;
    reason: TransactionTerminalReason;
  }) {
    return await this.#resourceLock.withKey(deriveApprovalResourceKeyFromAggregate(params.aggregate), async () => {
      return await this.#transactions.failSubmission({
        transactionId: params.aggregate.record.id,
        submissionId: params.submissionId,
        reason: params.reason,
      });
    });
  }

  #buildFailureReason(params: { error: unknown; phase: "create_broadcast_artifact" | "broadcast"; namespace: string }) {
    const details =
      isArxBaseError(params.error) && params.error.details && typeof params.error.details === "object"
        ? (structuredClone(params.error.details) as JsonValue)
        : null;

    return buildTransactionTerminalReason({
      kind: params.phase === "broadcast" ? "broadcast_failed" : "signing_failed",
      namespace: params.namespace,
      code: isArxBaseError(params.error) ? params.error.code : `${params.namespace}.${params.phase}`,
      message: params.error instanceof Error ? params.error.message : `${params.phase} failed`,
      details,
    });
  }
}
