import type { TransactionRecord } from "./types.js";

type ActiveConflictCandidate = Pick<TransactionRecord, "id" | "status" | "conflictKey">;

const hasSameConflictKey = (
  record: Pick<TransactionRecord, "conflictKey">,
  conflictKey: NonNullable<TransactionRecord["conflictKey"]>,
): boolean => record.conflictKey?.kind === conflictKey.kind && record.conflictKey.value === conflictKey.value;

const isActiveSameConflictKeyRecord = (
  record: Pick<TransactionRecord, "status" | "conflictKey">,
  conflictKey: NonNullable<TransactionRecord["conflictKey"]>,
): boolean => {
  return (record.status === "submitting" || record.status === "submitted") && hasSameConflictKey(record, conflictKey);
};

export const findBlockingActiveTransactionRecords = (
  record: Pick<TransactionRecord, "id" | "conflictKey" | "replacement">,
  candidates: readonly ActiveConflictCandidate[],
): ActiveConflictCandidate[] => {
  const conflictKey = record.conflictKey;
  if (!conflictKey) {
    return [];
  }

  const activeRecords = candidates.filter(
    (candidate) => candidate.id !== record.id && isActiveSameConflictKeyRecord(candidate, conflictKey),
  );
  if (record.replacement === null) {
    return activeRecords;
  }

  const replacementTargetId = record.replacement.transactionId;
  const replacesSubmittedRecord = activeRecords.some(
    (candidate) => candidate.id === replacementTargetId && candidate.status === "submitted",
  );

  return replacesSubmittedRecord
    ? activeRecords.filter((candidate) => candidate.status === "submitting")
    : activeRecords;
};
