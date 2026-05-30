import {
  TransactionAggregateConflictError,
  TransactionAggregateInvariantError,
  TransactionAggregateNotFoundError,
  TransactionSubmissionArtifactConflictError,
} from "./errors.js";
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
  ApproveTransactionInput,
  BeginSubmissionSigningInput,
  CompleteSubmissionSigningInput,
  CreateTransactionInput,
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
  TransactionSubmission,
  TransactionSubmissionStatus,
} from "./types.js";

type PreSubmittedTerminalStatus = Extract<TransactionSubmissionStatus, "failed" | "cancelled" | "expired">;

type ActiveSubmissionCommand = {
  transactionId: string;
  submissionId: string;
};

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

/**
 * Owns the transaction aggregate state machine.
 *
 * This implementation is in-memory. Storage and runtime adapters should still
 * use these commands instead of patching records directly.
 */
export class TransactionAggregateService {
  #aggregates = new Map<string, TransactionAggregate>();
  #now: () => number;
  #createId: () => string;

  constructor(options: TransactionAggregateServiceOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? crypto.randomUUID;
  }

  /** Returns a cloned snapshot by transaction id. */
  getTransactionAggregate(transactionId: string): TransactionAggregate | null {
    const aggregate = this.#aggregates.get(transactionId);
    return aggregate ? cloneAggregate(aggregate) : null;
  }

  /** Creates the record before approval or broadcast. */
  createTransaction(input: CreateTransactionInput): TransactionAggregate {
    const id = input.id ?? this.#createId();
    if (this.#aggregates.has(id)) {
      throw new TransactionAggregateConflictError(id);
    }

    const at = this.#now();
    const record: TransactionRecord = {
      id,
      namespace: input.namespace,
      chainRef: input.chainRef,
      origin: input.origin,
      source: input.source,
      requestId: input.requestId ?? null,
      accountKey: input.accountKey,
      status: "awaiting_approval",
      request: {
        kind: input.request.kind,
        payload: cloneJsonValue(input.request.payload),
      },
      approvedRequest: null,
      activeSubmissionId: null,
      submitted: null,
      receipt: null,
      conflictKey: null,
      replacesTransactionId: input.replacement?.transactionId ?? null,
      replacementType: input.replacement?.type ?? null,
      replacedByTransactionId: null,
      terminalReason: null,
      createdAt: at,
      updatedAt: at,
    };

    const aggregate: TransactionAggregate = {
      record,
      submissions: [],
      submissionArtifacts: [],
    };
    this.#aggregates.set(id, aggregate);
    return cloneAggregate(aggregate);
  }

  /**
   * Commits approval and queues the first submission.
   *
   * Prepare, signing, and broadcast happen in later commands.
   */
  approveTransaction(input: ApproveTransactionInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate, at) => {
      const { record } = aggregate;
      assertTransactionStatusTransition(record.status, "submitting");

      const submissionId = input.submissionId ?? this.#createId();
      record.status = "submitting";
      record.approvedRequest = {
        approvalId: input.approvalId,
        payload: cloneJsonValue(input.approvedRequestPayload),
        approvedAt: input.approvedAt ?? at,
      };
      record.activeSubmissionId = submissionId;
      record.conflictKey = input.conflictKey;
      aggregate.submissions.push({
        id: submissionId,
        transactionId: record.id,
        status: "queued",
        artifactId: null,
        terminalReason: null,
        createdAt: at,
        updatedAt: at,
      });
    });
  }

  /** Records explicit user rejection. */
  rejectTransaction(input: TerminalTransactionInput): TransactionAggregate {
    return this.#finalizeAwaitingApprovalTransaction(
      input.transactionId,
      "rejected",
      input.reason ??
        buildTransactionTerminalReason({
          kind: "user_rejected",
        }),
    );
  }

  /** Cancels before network acceptance. */
  cancelTransaction(input: TerminalTransactionInput): TransactionAggregate {
    return this.#finalizeBeforeNetworkAcceptance(
      input.transactionId,
      "cancelled",
      input.reason ??
        buildTransactionTerminalReason({
          kind: "approval_cancelled",
        }),
    );
  }

  /** Expires an approval or submission window before network acceptance. */
  expireTransaction(input: TerminalTransactionInput): TransactionAggregate {
    return this.#finalizeBeforeNetworkAcceptance(
      input.transactionId,
      "expired",
      input.reason ??
        buildTransactionTerminalReason({
          kind: "approval_expired",
        }),
    );
  }

  /** Fails before network acceptance. */
  failTransaction(input: FailTransactionInput): TransactionAggregate {
    return this.#finalizeBeforeNetworkAcceptance(input.transactionId, "failed", input.reason);
  }

  /** Starts signing the active submission. */
  beginSubmissionSigning(input: BeginSubmissionSigningInput): TransactionAggregate {
    return this.#transitionActiveSubmission(input, "signing");
  }

  /** Stores the sealed artifact outside TransactionRecord. */
  completeSubmissionSigning(input: CompleteSubmissionSigningInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate, at) => {
      this.#requireSubmittingRecord(aggregate.record);
      const submission = this.#requireActiveSubmission(aggregate, input.submissionId);
      assertTransactionSubmissionStatusTransition(submission.status, "signed");

      const artifactId = input.artifactId ?? this.#createId();
      if (aggregate.submissionArtifacts.some((artifact) => artifact.id === artifactId)) {
        throw new TransactionSubmissionArtifactConflictError(artifactId);
      }

      submission.status = "signed";
      submission.artifactId = artifactId;
      submission.updatedAt = at;
      aggregate.submissionArtifacts.push({
        id: artifactId,
        transactionId: aggregate.record.id,
        submissionId: submission.id,
        namespace: aggregate.record.namespace,
        chainRef: aggregate.record.chainRef,
        kind: input.artifactKind,
        sealedPayload: cloneJsonValue(input.sealedPayload),
        retention: input.retention ?? "until_submitted",
        expiresAt: input.expiresAt ?? null,
        createdAt: at,
      });
    });
  }

  /**
   * Marks the active submission as broadcasting.
   *
   * The caller may broadcast only after this command succeeds.
   */
  queueSubmissionBroadcast(input: QueueSubmissionBroadcastInput): TransactionAggregate {
    return this.#transitionActiveSubmission(input, "broadcasting");
  }

  /** Marks the submission accepted and the transaction submitted. */
  recordBroadcastAcceptance(input: RecordBroadcastAcceptanceInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate, at) => {
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
  failSubmission(input: TerminalSubmissionInput): TransactionAggregate {
    return this.#finalizeActiveSubmission(input, "failed");
  }

  /** Cancels the active submission and parent transaction. */
  cancelSubmission(input: TerminalSubmissionInput): TransactionAggregate {
    return this.#finalizeActiveSubmission(input, "cancelled");
  }

  /** Expires the active submission and parent transaction. */
  expireSubmission(input: TerminalSubmissionInput): TransactionAggregate {
    return this.#finalizeActiveSubmission(input, "expired");
  }

  /** Records successful chain confirmation. */
  recordTransactionConfirmed(input: RecordTransactionReceiptInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "confirmed");
      aggregate.record.status = "confirmed";
      aggregate.record.receipt = cloneJsonValue(input.receipt);
    });
  }

  /** Records chain execution failure. */
  recordTransactionFailedOnChain(input: RecordTransactionFailedOnChainInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "failed");
      aggregate.record.status = "failed";
      aggregate.record.receipt = cloneJsonValue(input.receipt);
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  /** Records replacement by another known local transaction. */
  recordTransactionReplaced(input: RecordTransactionReplacedInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "replaced");
      aggregate.record.status = "replaced";
      aggregate.record.replacedByTransactionId = input.replacedByTransactionId;
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  /** Records that tracking no longer expects confirmation. */
  recordTransactionDropped(input: RecordTransactionDroppedInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "dropped");
      aggregate.record.status = "dropped";
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  /** Records that tracking found a known expiry condition. */
  recordTransactionExpired(input: RecordTransactionExpiredInput): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, "expired");
      aggregate.record.status = "expired";
      aggregate.record.terminalReason = cloneTransactionTerminalReason(input.reason);
    });
  }

  #finalizeAwaitingApprovalTransaction(
    transactionId: string,
    status: "rejected" | "expired" | "cancelled" | "failed",
    reason: TransactionTerminalReason,
  ): TransactionAggregate {
    return this.#updateAggregate(transactionId, (aggregate) => {
      assertTransactionStatusTransition(aggregate.record.status, status);
      aggregate.record.status = status;
      aggregate.record.terminalReason = cloneTransactionTerminalReason(reason);
    });
  }

  #finalizeBeforeNetworkAcceptance(
    transactionId: string,
    status: PreSubmittedTerminalStatus,
    reason: TransactionTerminalReason,
  ): TransactionAggregate {
    return this.#updateAggregate(transactionId, (aggregate, at) => {
      if (aggregate.record.status !== "submitting") {
        assertTransactionStatusTransition(aggregate.record.status, status);
        aggregate.record.status = status;
        aggregate.record.terminalReason = cloneTransactionTerminalReason(reason);
        return;
      }

      const activeSubmission = this.#requireActiveSubmission(aggregate);
      this.#assertPreSubmittedTerminalAllowed(aggregate.record.id, activeSubmission, status);
      assertTransactionStatusTransition(aggregate.record.status, status);
      this.#writeSubmissionTerminal(activeSubmission, status, reason, at);
      aggregate.record.activeSubmissionId = null;
      aggregate.record.status = status;
      aggregate.record.terminalReason = cloneTransactionTerminalReason(reason);
    });
  }

  #transitionActiveSubmission(
    input: ActiveSubmissionCommand,
    status: "signing" | "broadcasting",
  ): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate, at) => {
      this.#requireSubmittingRecord(aggregate.record);
      const submission = this.#requireActiveSubmission(aggregate, input.submissionId);
      assertTransactionSubmissionStatusTransition(submission.status, status);
      submission.status = status;
      submission.updatedAt = at;
    });
  }

  #finalizeActiveSubmission(
    input: TerminalSubmissionInput,
    status: "failed" | "cancelled" | "expired",
  ): TransactionAggregate {
    return this.#updateAggregate(input.transactionId, (aggregate, at) => {
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
    transactionId: string,
    mutate: (aggregate: TransactionAggregate, updatedAt: number) => void,
  ): TransactionAggregate {
    const current = this.#aggregates.get(transactionId);
    if (!current) {
      throw new TransactionAggregateNotFoundError(transactionId);
    }
    // Terminal records are closed. Later corrections need a named command.
    if (isTransactionStatusTerminal(current.record.status)) {
      throw new TransactionAggregateInvariantError(
        transactionId,
        `Terminal transaction "${transactionId}" cannot continue from status "${current.record.status}".`,
      );
    }

    const next = cloneAggregate(current);
    const updatedAt = this.#now();
    mutate(next, updatedAt);
    next.record.updatedAt = updatedAt;
    this.#aggregates.set(transactionId, next);
    return cloneAggregate(next);
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
