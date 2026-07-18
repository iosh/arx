import type { Accounts } from "../../accounts/Accounts.js";
import { isArxBaseError } from "../../errors.js";
import type { TransactionAggregate, TransactionTerminalReason } from "../aggregate/index.js";
import { buildTransactionTerminalReason, type TransactionAggregateStore } from "../aggregate/index.js";
import { buildBroadcastArtifactContext, buildBroadcastContext } from "../broadcastContexts.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { BroadcastArtifact, BroadcastResult } from "../namespace/types.js";
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
  accounts: Pick<Accounts, "getAddress">;
  resourceLock: TransactionResourceLock;
};

export type TransactionSubmissionResult = {
  aggregate: TransactionAggregate;
  broadcastArtifact: BroadcastArtifact;
};

export type SubmitApprovedTransactionOptions = {
  lock?: "acquire" | "held";
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
  #accounts: Pick<Accounts, "getAddress">;
  #resourceLock: TransactionResourceLock;

  constructor(deps: TransactionSubmissionExecutorDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accounts = deps.accounts;
    this.#resourceLock = deps.resourceLock;
  }

  /**
   * Flow:
   * queued -> signing(createBroadcastArtifact) -> broadcasting(broadcast) -> accepted/submitted
   *                                         \-> failed
   *                            broadcast    \-> failed
   */
  async submitApprovedTransaction(
    transactionId: string,
    options?: SubmitApprovedTransactionOptions,
  ): Promise<TransactionSubmissionResult> {
    if (options?.lock === "held") {
      return await this.#submitLoadedApprovedTransaction(await this.#loadSubmittingAggregate(transactionId));
    }

    const current = await this.#loadSubmittingAggregate(transactionId);
    return await this.#resourceLock.withKey(current.record.resourceKey, async () => {
      return await this.#submitLoadedApprovedTransaction(current);
    });
  }

  async #submitLoadedApprovedTransaction(current: TransactionAggregate): Promise<TransactionSubmissionResult> {
    const submissionId = this.#requireActiveSubmissionId(current);
    const namespaceTransaction = this.#namespaces.require(current.record.namespace);
    const submission = namespaceTransaction.submission;

    const signing = await this.#transactions.beginSubmissionSigning({
      transactionId: current.record.id,
      submissionId,
    });

    let broadcastArtifact: BroadcastArtifact;
    try {
      broadcastArtifact = await submission.createBroadcastArtifact(
        buildBroadcastArtifactContext(signing, this.#accounts),
      );
    } catch (error) {
      await this.#failSubmission({
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
      broadcastResult = await submission.broadcast(
        buildBroadcastContext(broadcasting, broadcastArtifact, this.#accounts),
      );
    } catch (error) {
      await this.#failSubmission({
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
        submitted: broadcastResult.submitted,
      });

      return {
        aggregate: accepted,
        broadcastArtifact,
      };
    } catch (error) {
      throw new TransactionAcceptanceCommitError({
        transactionId: current.record.id,
        submissionId,
        broadcastIdentity: broadcastResult.broadcastIdentity,
        submitted: broadcastResult.submitted,
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

  async #failSubmission(params: {
    aggregate: TransactionAggregate;
    submissionId: string;
    reason: TransactionTerminalReason;
  }) {
    return await this.#transactions.failSubmission({
      transactionId: params.aggregate.record.id,
      submissionId: params.submissionId,
      reason: params.reason,
    });
  }

  #buildFailureReason(params: { error: unknown; phase: "create_broadcast_artifact" | "broadcast"; namespace: string }) {
    return buildTransactionTerminalReason({
      kind: params.phase === "broadcast" ? "broadcast_failed" : "signing_failed",
      namespace: params.namespace,
      code: isArxBaseError(params.error) ? params.error.code : `${params.namespace}.${params.phase}`,
      message: params.error instanceof Error ? params.error.message : `${params.phase} failed`,
      details: isArxBaseError(params.error) && params.error.details ? structuredClone(params.error.details) : {},
    });
  }
}
