import { isArxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { JsonValue, TransactionAggregate } from "../aggregate/index.js";
import { buildTransactionTerminalReason, type TransactionAggregateStore } from "../aggregate/index.js";
import { buildBroadcastContext, buildBroadcastInputContext } from "../broadcastContexts.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../namespace/operations.js";
import type { BroadcastInput, BroadcastResult, NamespaceTransactionSubmission } from "../namespace/types.js";
import { TransactionAcceptanceCommitError } from "./errors.js";

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
};

export type TransactionSubmissionResult = {
  aggregate: TransactionAggregate;
  broadcastInput: BroadcastInput;
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

  constructor(deps: TransactionSubmissionExecutorDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accountCodecs = deps.accountCodecs;
  }

  /**
   * Flow:
   * queued -> signing(createBroadcastInput) -> broadcasting(broadcast) -> accepted/submitted
   *                                      \-> failed
   *                         broadcast    \-> failed
   */
  async submitApprovedTransaction(transactionId: string): Promise<TransactionSubmissionResult> {
    const current = await this.#loadSubmittingAggregate(transactionId);
    const submissionId = this.#requireActiveSubmissionId(current);
    const namespaceTransaction = this.#namespaces.require(current.record.namespace);
    const submission = requireNamespaceTransactionOperation<NamespaceTransactionSubmission>({
      namespace: current.record.namespace,
      operation: "submission.createBroadcastInput",
      value: namespaceTransaction.submission,
    });

    const signing = await this.#transactions.beginSubmissionSigning({
      transactionId,
      submissionId,
    });

    let broadcastInput: BroadcastInput;
    try {
      broadcastInput = await submission.createBroadcastInput(buildBroadcastInputContext(signing, this.#accountCodecs));
    } catch (error) {
      await this.#transactions.failSubmission({
        transactionId,
        submissionId,
        reason: this.#buildFailureReason({
          error,
          phase: "create_broadcast_input",
          namespace: signing.record.namespace,
        }),
      });
      throw error;
    }

    const broadcasting = await this.#transactions.queueSubmissionBroadcast({
      transactionId,
      submissionId,
    });

    let broadcastResult: BroadcastResult;
    try {
      const broadcast = requireNamespaceTransactionOperation({
        namespace: broadcasting.record.namespace,
        operation: "submission.broadcast",
        value: namespaceTransaction.submission?.broadcast,
      });
      broadcastResult = await broadcast(buildBroadcastContext(broadcasting, broadcastInput, this.#accountCodecs));
    } catch (error) {
      await this.#transactions.failSubmission({
        transactionId,
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
        transactionId,
        submissionId,
        submitted: broadcastResult.submitted as never,
        conflictKey: broadcastResult.conflictKey,
      });

      return {
        aggregate: accepted,
        broadcastInput,
      };
    } catch (error) {
      throw new TransactionAcceptanceCommitError({
        transactionId,
        submissionId,
        broadcastIdentity: structuredClone(broadcastResult.broadcastIdentity as JsonValue),
        submitted: structuredClone(broadcastResult.submitted as JsonValue),
        cause: error,
      });
    }
  }

  async #loadSubmittingAggregate(transactionId: string) {
    const aggregate = await this.#transactions.loadTransactionAggregate(transactionId);
    if (!aggregate) {
      throw new Error(`Transaction "${transactionId}" was not found.`);
    }
    if (aggregate.record.status !== "submitting") {
      throw new Error(`Transaction "${transactionId}" is not submitting.`);
    }
    return aggregate;
  }

  #requireActiveSubmissionId(aggregate: TransactionAggregate) {
    const submissionId = aggregate.record.activeSubmissionId;
    if (!submissionId) {
      throw new Error(`Transaction "${aggregate.record.id}" is missing an active submission.`);
    }
    return submissionId;
  }

  #buildFailureReason(params: { error: unknown; phase: "create_broadcast_input" | "broadcast"; namespace: string }) {
    const details =
      isArxError(params.error) && params.error.data && typeof params.error.data === "object"
        ? (structuredClone(params.error.data) as JsonValue)
        : null;

    return buildTransactionTerminalReason({
      kind: params.phase === "broadcast" ? "broadcast_failed" : "signing_failed",
      namespace: params.namespace,
      code: isArxError(params.error) ? params.error.reason : `${params.namespace}.${params.phase}`,
      message: params.error instanceof Error ? params.error.message : `${params.phase} failed`,
      details,
    });
  }
}
