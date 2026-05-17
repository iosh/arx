/** Execution checkpoint used by cancellation and recovery logic. */
export type TransactionExecutionAttemptPhase =
  | "queued"
  | "processing"
  | "signing"
  | "broadcasting"
  | "persisting_record";
