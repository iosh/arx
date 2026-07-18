import { persistenceChange } from "../persistence/change.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import {
  type SubmittedTransactionRecord,
  type TransactionFailureReason,
  type TransactionJsonObject,
  type TransactionRecord,
  transactionPersistenceType,
} from "./persistence.js";
import {
  TransactionConflictError,
  TransactionFinalizationRejectedError,
  TransactionRecordNotFoundError,
  TransactionReplacementTargetError,
} from "./recordErrors.js";
import type { TransactionResourceQueue } from "./TransactionResourceQueue.js";
import {
  getTransactionNamespaceAdapter,
  type TransactionBroadcastOutcome,
  type TransactionNamespaceAdapters,
  type TransactionSubmissionInput,
} from "./transactionNamespace.js";
import {
  createSubmittingTransaction,
  failTransactionBeforeSubmission,
  markTransactionBroadcasting,
  markTransactionSubmitted,
} from "./transactionRecord.js";

const ACTIVE_STATUSES = ["submitting", "broadcasting", "submitted"] as const;
const ACTIVE_STATUS_SET = new Set<TransactionRecord["status"]>(ACTIVE_STATUSES);

const failureFromError = (error: unknown, code: string, message: string): TransactionFailureReason => ({
  code,
  message: error instanceof Error && error.message ? error.message : message,
});

const requireCurrent = async (
  readers: Pick<CorePersistenceReaders, "transactions">,
  transactionId: string,
): Promise<TransactionRecord> => {
  const record = await readers.transactions.get(transactionId);
  if (!record) throw new TransactionRecordNotFoundError(transactionId);
  return record;
};

const assertConflictAvailable = (params: {
  transactionId: string;
  replacementTargetId?: string;
  candidates: readonly TransactionRecord[];
}): void => {
  const active = params.candidates.filter((candidate) => ACTIVE_STATUS_SET.has(candidate.status));
  if (params.replacementTargetId) {
    const target = active.find(
      (candidate) => candidate.transactionId === params.replacementTargetId && candidate.status === "submitted",
    );
    if (!target) {
      throw new TransactionReplacementTargetError({
        submissionTransactionId: params.transactionId,
        targetTransactionId: params.replacementTargetId,
      });
    }
    if (!target.conflictKey) {
      throw new TransactionReplacementTargetError({
        submissionTransactionId: params.transactionId,
        targetTransactionId: params.replacementTargetId,
      });
    }
    const blockers = active.filter((candidate) => candidate.status !== "submitted");
    if (blockers.length === 0) return;
    throw new TransactionConflictError({
      transactionId: params.transactionId,
      conflictKey: target.conflictKey,
      conflictingTransactionIds: blockers.map((candidate) => candidate.transactionId),
    });
  }
  if (active.length === 0) return;
  const conflictKey = active[0]?.conflictKey;
  if (!conflictKey) return;
  throw new TransactionConflictError({
    transactionId: params.transactionId,
    conflictKey,
    conflictingTransactionIds: active.map((candidate) => candidate.transactionId),
  });
};

export const submitTransaction = async (params: {
  readers: Pick<CorePersistenceReaders, "transactions">;
  mutations: CoreMutationQueue;
  adapters: TransactionNamespaceAdapters;
  resources: TransactionResourceQueue;
  input: TransactionSubmissionInput;
  publishChanged(transactionIds: readonly string[]): void;
  onSubmitted(record: SubmittedTransactionRecord): void;
}): Promise<TransactionRecord> => {
  const adapter = getTransactionNamespaceAdapter(params.adapters, params.input.chainRef);
  const transactionId = crypto.randomUUID();
  const resourceKey = adapter.getResourceKey(params.input);

  const finalized = await params.resources.run(resourceKey, async () => {
    const activeTransactions = await params.readers.transactions.listByStatuses(ACTIVE_STATUSES);
    const draft = await adapter.finalize({
      transactionId,
      submission: params.input,
      activeTransactions,
    });
    if (draft.status === "rejected") {
      throw new TransactionFinalizationRejectedError(draft.reason);
    }
    const submitting = createSubmittingTransaction({
      transactionId,
      chainRef: params.input.chainRef,
      accountId: params.input.accountId,
      origin: params.input.origin,
      source: params.input.source,
      createAt: Date.now(),
      signingPayload: draft.signingPayload,
      ...(draft.conflictKey ? { conflictKey: draft.conflictKey } : {}),
    });

    await params.mutations.run(async (commit) => {
      const candidates = draft.conflictKey
        ? await params.readers.transactions.listByConflictKey({
            chainRef: params.input.chainRef,
            conflictKey: draft.conflictKey,
          })
        : [];
      if (params.input.replacementTargetId && !draft.conflictKey) {
        throw new TransactionReplacementTargetError({
          submissionTransactionId: transactionId,
          targetTransactionId: params.input.replacementTargetId,
        });
      }
      assertConflictAvailable({
        transactionId,
        ...(params.input.replacementTargetId ? { replacementTargetId: params.input.replacementTargetId } : {}),
        candidates,
      });
      await commit([persistenceChange.put(transactionPersistenceType, submitting)]);
      params.publishChanged([transactionId]);
    });
    return draft;
  });

  // Keep account-state rechecks, signing, and the broadcasting commit in one serialized operation.
  const signing = await params.mutations.run(async (commit) => {
    let signedPayload: TransactionJsonObject;
    try {
      signedPayload = await adapter.sign({
        accountId: params.input.accountId,
        chainRef: params.input.chainRef,
        signingPayload: finalized.signingPayload,
      });
    } catch (error) {
      const failed = failTransactionBeforeSubmission(await requireCurrent(params.readers, transactionId), {
        phase: "submitting",
        reason: failureFromError(error, "transaction.signing_failed", "Transaction signing failed."),
      });

      await commit([persistenceChange.put(transactionPersistenceType, failed)]);
      params.publishChanged([transactionId]);

      return { status: "failed" as const, record: failed };
    }

    const next = markTransactionBroadcasting(await requireCurrent(params.readers, transactionId));
    await commit([persistenceChange.put(transactionPersistenceType, next)]);
    params.publishChanged([transactionId]);

    return { status: "signed" as const, signedPayload };
  });

  if (signing.status === "failed") return signing.record;
  const signedPayload = signing.signedPayload;

  let outcome: TransactionBroadcastOutcome;
  try {
    outcome = await adapter.broadcast({
      chainRef: params.input.chainRef,
      signingPayload: finalized.signingPayload,
      signedPayload,
    });
  } catch (error) {
    outcome = {
      status: "unknown" as const,
      reason: failureFromError(
        error,
        "transaction.broadcast_outcome_unknown",
        "Transaction broadcast outcome is unknown.",
      ),
    };
  }

  return await params.mutations.run(async (commit) => {
    const current = await requireCurrent(params.readers, transactionId);
    const next =
      outcome.status === "submitted"
        ? markTransactionSubmitted(current, outcome.networkSubmission)
        : failTransactionBeforeSubmission(current, {
            phase: "broadcasting",
            reason: outcome.reason,
          });
    await commit([persistenceChange.put(transactionPersistenceType, next)]);
    params.publishChanged([transactionId]);
    if (next.status === "submitted") params.onSubmitted(next);
    return next;
  });
};
