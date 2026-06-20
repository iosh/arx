import { TransactionAggregateInvariantError } from "./errors.js";
import { cloneJsonValue } from "./json.js";
import {
  assertTransactionStatusTransition,
  assertTransactionSubmissionStatusTransition,
  isTransactionStatusTerminal,
  isTransactionSubmissionStatusTerminal,
} from "./stateMachine.js";
import {
  buildTransactionTerminalReason,
  cloneTransactionTerminalReason,
  type TransactionTerminalReason,
} from "./terminalReason.js";
import type {
  BeginSubmissionSigningInput,
  CreateApprovedTransactionInput,
  FailTransactionInput,
  QueueSubmissionBroadcastInput,
  RecordBroadcastAcceptanceInput,
  RecordTransactionDroppedInput,
  RecordTransactionExpiredInput,
  RecordTransactionFailedOnChainInput,
  RecordTransactionReceiptInput,
  RecordTransactionReplacedInput,
  TerminalSubmissionInput,
  TerminalTransactionInput,
  TransactionAggregate,
  TransactionAggregateServiceOptions,
  TransactionRecord,
  TransactionRestartAction,
  TransactionSubmission,
  TransactionSubmissionStatus,
} from "./types.js";

type PreSubmittedTerminalStatus = Extract<TransactionSubmissionStatus, "failed" | "cancelled" | "expired">;

type LoadedAggregateInput<T extends { transactionId: string }> = Omit<T, "transactionId">;

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

/**
 * Owns the state transitions for one transaction aggregate.
 *
 * Storage and runtime code should load the current aggregate, pass it through a
 * named command here, then persist the returned next aggregate.
 */
export class TransactionAggregateService {
  #now: () => number;
  #createId: () => string;

  constructor(options: TransactionAggregateServiceOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  /** Creates the durable wallet transaction after user approval. */
  createApprovedTransaction(input: CreateApprovedTransactionInput): TransactionAggregate {
    const id = this.#createId();
    const at = this.#now();
    const submissionId = input.submissionId ?? this.#createId();

    return {
      record: {
        id,
        namespace: input.namespace,
        chainRef: input.chainRef,
        origin: input.origin,
        source: input.source,
        requestId: input.requestId ?? null,
        accountKey: input.accountKey,
        status: "submitting",
        request: {
          payload: cloneJsonValue(input.request.payload),
        },
        approvedRequest: {
          approvalId: input.approvalId,
          payload: cloneJsonValue(input.approvedRequestPayload),
          approvedAt: input.approvedAt ?? at,
        },
        activeSubmissionId: submissionId,
        submitted: null,
        receipt: null,
        conflictKey: input.conflictKey,
        replacesTransactionId: input.replacement?.transactionId ?? null,
        replacementType: input.replacement?.type ?? null,
        replacedByTransactionId: null,
        terminalReason: null,
        createdAt: at,
        updatedAt: at,
      },
      submissions: [
        {
          id: submissionId,
          transactionId: id,
          status: "queued",
          terminalReason: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
    };
  }

  /** Locally cancels a durable transaction before network acceptance. */
  cancelTransaction(
    current: TransactionAggregate,
    input: LoadedAggregateInput<TerminalTransactionInput>,
  ): TransactionAggregate {
    return this.#finalizeActiveTransaction(
      current,
      input.reason ?? this.#buildDefaultTerminalReason("cancelled"),
      "cancelled",
    );
  }

  /** Expires a durable transaction before network acceptance. */
  expireTransaction(
    current: TransactionAggregate,
    input: LoadedAggregateInput<TerminalTransactionInput>,
  ): TransactionAggregate {
    return this.#finalizeActiveTransaction(
      current,
      input.reason ?? this.#buildDefaultTerminalReason("expired"),
      "expired",
    );
  }

  /** Fails a durable transaction before network acceptance. */
  failTransaction(
    current: TransactionAggregate,
    input: LoadedAggregateInput<FailTransactionInput>,
  ): TransactionAggregate {
    return this.#finalizeActiveTransaction(current, input.reason, "failed");
  }

  /** Starts broadcast-input creation for the active submission. */
  beginSubmissionSigning(
    current: TransactionAggregate,
    input: LoadedAggregateInput<BeginSubmissionSigningInput>,
  ): TransactionAggregate {
    return this.#transitionActiveSubmission(current, input, "signing");
  }

  /**
   * Marks the active submission as broadcasting.
   *
   * The caller may broadcast only after this command succeeds.
   */
  queueSubmissionBroadcast(
    current: TransactionAggregate,
    input: LoadedAggregateInput<QueueSubmissionBroadcastInput>,
  ): TransactionAggregate {
    return this.#transitionActiveSubmission(current, input, "broadcasting");
  }

  /** Marks the submission accepted and the transaction submitted. */
  recordBroadcastAcceptance(
    current: TransactionAggregate,
    input: LoadedAggregateInput<RecordBroadcastAcceptanceInput>,
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate, at) => {
      assertTransactionStatusTransition(aggregate.record.status, "submitted");

      const submission = this.#requireActiveSubmission(aggregate, input.submissionId);
      assertTransactionSubmissionStatusTransition(submission.status, "accepted");
      submission.status = "accepted";
      submission.updatedAt = at;

      aggregate.record.status = "submitted";
      aggregate.record.activeSubmissionId = null;
      aggregate.record.submitted = cloneJsonValue(input.submitted);
    });
  }

  /** Fails the active submission and parent transaction. */
  failSubmission(
    current: TransactionAggregate,
    input: LoadedAggregateInput<TerminalSubmissionInput>,
  ): TransactionAggregate {
    return this.#finalizeActiveSubmission(current, input, "failed");
  }

  /** Cancels the active submission and parent transaction. */
  cancelSubmission(
    current: TransactionAggregate,
    input: LoadedAggregateInput<TerminalSubmissionInput>,
  ): TransactionAggregate {
    return this.#finalizeActiveSubmission(current, input, "cancelled");
  }

  /** Expires the active submission and parent transaction. */
  expireSubmission(
    current: TransactionAggregate,
    input: LoadedAggregateInput<TerminalSubmissionInput>,
  ): TransactionAggregate {
    return this.#finalizeActiveSubmission(current, input, "expired");
  }

  /** Records successful chain confirmation. */
  recordTransactionConfirmed(
    current: TransactionAggregate,
    input: LoadedAggregateInput<RecordTransactionReceiptInput>,
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "confirmed");
      aggregate.record.status = "confirmed";
      aggregate.record.receipt = cloneJsonValue(input.receipt);
    });
  }

  /** Records chain execution failure. */
  recordTransactionFailedOnChain(
    current: TransactionAggregate,
    input: LoadedAggregateInput<RecordTransactionFailedOnChainInput>,
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "failed");
      aggregate.record.status = "failed";
      aggregate.record.receipt = cloneJsonValue(input.receipt);
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  /** Records replacement by another known local transaction. */
  recordTransactionReplaced(
    current: TransactionAggregate,
    input: LoadedAggregateInput<RecordTransactionReplacedInput>,
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "replaced");
      aggregate.record.status = "replaced";
      aggregate.record.replacedByTransactionId = input.replacedByTransactionId;
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  /** Records that tracking no longer expects confirmation. */
  recordTransactionDropped(
    current: TransactionAggregate,
    input: LoadedAggregateInput<RecordTransactionDroppedInput>,
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "dropped");
      aggregate.record.status = "dropped";
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  /** Records that tracking found a known expiry condition. */
  recordTransactionExpired(
    current: TransactionAggregate,
    input: LoadedAggregateInput<RecordTransactionExpiredInput>,
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "expired");
      aggregate.record.status = "expired";
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  /**
   * Recovery flowchart:
   *
   * submitting(queued|signing|broadcasting) -> fail incomplete local work
   * submitted(accepted) -> monitor refresh resumes tracking
   * terminal -> no work
   */
  listRestartActions(aggregate: TransactionAggregate): TransactionRestartAction[] {
    const { record } = aggregate;

    if (record.status === "submitting") {
      return [
        {
          kind: "finalize_incomplete_local",
          transactionId: record.id,
          targetStatus: "failed",
          reason: buildTransactionTerminalReason({
            kind: "broadcast_outcome_unknown",
            code: "incomplete_at_startup",
            message: "Transaction submission was incomplete at startup.",
          }),
        },
      ];
    }

    return [];
  }

  #transitionActiveSubmission(
    current: TransactionAggregate,
    input: LoadedAggregateInput<BeginSubmissionSigningInput>,
    status: "signing" | "broadcasting",
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate, at) => {
      this.#requireSubmittingRecord(aggregate.record);
      const submission = this.#requireActiveSubmission(aggregate, input.submissionId);
      assertTransactionSubmissionStatusTransition(submission.status, status);
      submission.status = status;
      submission.updatedAt = at;
    });
  }

  #finalizeActiveSubmission(
    current: TransactionAggregate,
    input: LoadedAggregateInput<TerminalSubmissionInput>,
    status: "failed" | "cancelled" | "expired",
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate, at) => {
      this.#requireSubmittingRecord(aggregate.record);
      const submission = this.#requireActiveSubmission(aggregate, input.submissionId);
      this.#assertPreSubmittedTerminalAllowed(aggregate.record.id, submission, status);
      assertTransactionStatusTransition(aggregate.record.status, status);
      this.#writeSubmissionTerminal(submission, status, input.reason, at);
      aggregate.record.activeSubmissionId = null;
      aggregate.record.status = status;
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  #finalizeActiveTransaction(
    current: TransactionAggregate,
    reason: TransactionTerminalReason,
    status: PreSubmittedTerminalStatus,
  ): TransactionAggregate {
    return this.#updateAggregate(current, (aggregate, at) => {
      this.#requireSubmittingRecord(aggregate.record);
      const submission = this.#requireActiveSubmission(aggregate);
      this.#assertPreSubmittedTerminalAllowed(aggregate.record.id, submission, status);
      assertTransactionStatusTransition(aggregate.record.status, status);
      this.#writeSubmissionTerminal(submission, status, reason, at);
      aggregate.record.activeSubmissionId = null;
      aggregate.record.status = status;
      aggregate.record.terminalReason = cloneTransactionTerminalReason(reason);
    });
  }

  #buildDefaultTerminalReason(status: Exclude<PreSubmittedTerminalStatus, "failed">): TransactionTerminalReason {
    return buildTransactionTerminalReason({
      kind: status === "cancelled" ? "approval_cancelled" : "approval_expired",
    });
  }

  #assertPreSubmittedTerminalAllowed(
    transactionId: string,
    submission: TransactionSubmission,
    status: PreSubmittedTerminalStatus,
  ): void {
    if (status === "cancelled" && submission.status === "broadcasting") {
      throw new TransactionAggregateInvariantError(
        transactionId,
        `Transaction "${transactionId}" is already broadcasting; use replacement instead of local cancellation.`,
      );
    }
    assertTransactionSubmissionStatusTransition(submission.status, status);
  }

  #writeSubmissionTerminal(
    submission: TransactionSubmission,
    status: PreSubmittedTerminalStatus,
    reason: TransactionTerminalReason,
    updatedAt: number,
  ): void {
    submission.status = status;
    submission.terminalReason = cloneTransactionTerminalReason(reason);
    submission.updatedAt = updatedAt;
  }

  #updateAggregate(
    current: TransactionAggregate,
    mutate: (aggregate: TransactionAggregate, updatedAt: number) => void,
  ): TransactionAggregate {
    // Terminal records are closed. Later corrections need a named command.
    if (isTransactionStatusTerminal(current.record.status)) {
      throw new TransactionAggregateInvariantError(
        current.record.id,
        `Terminal transaction "${current.record.id}" cannot continue from status "${current.record.status}".`,
      );
    }

    const next = cloneAggregate(current);
    const updatedAt = this.#now();
    mutate(next, updatedAt);
    next.record.updatedAt = updatedAt;
    return next;
  }

  #requireSubmittingRecord(record: TransactionRecord): void {
    if (record.status !== "submitting") {
      throw new TransactionAggregateInvariantError(
        record.id,
        `Transaction "${record.id}" is not submitting; current status is "${record.status}".`,
      );
    }
  }

  #requireActiveSubmission(aggregate: TransactionAggregate, submissionId?: string): TransactionSubmission {
    const activeSubmissionId = aggregate.record.activeSubmissionId;
    if (!activeSubmissionId) {
      throw new TransactionAggregateInvariantError(
        aggregate.record.id,
        `Transaction "${aggregate.record.id}" is missing an active submission.`,
      );
    }
    if (submissionId !== undefined && submissionId !== activeSubmissionId) {
      throw new TransactionAggregateInvariantError(
        aggregate.record.id,
        `Submission "${submissionId}" is not active for transaction "${aggregate.record.id}".`,
      );
    }

    const submission = aggregate.submissions.find((candidate) => candidate.id === activeSubmissionId);
    if (!submission) {
      throw new TransactionAggregateInvariantError(
        aggregate.record.id,
        `Transaction "${aggregate.record.id}" is missing submission "${activeSubmissionId}".`,
      );
    }
    if (isTransactionSubmissionStatusTerminal(submission.status)) {
      throw new TransactionAggregateInvariantError(
        aggregate.record.id,
        `Terminal submission "${submission.id}" cannot continue from status "${submission.status}".`,
      );
    }

    return submission;
  }
}
