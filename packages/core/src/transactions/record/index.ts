import type { ChainRef } from "../../chains/ids.js";
import type { TransactionReplacementKey } from "../namespace/types.js";
import type { TransactionReceipt, TransactionSubmitted } from "../types.js";

export type TransactionRecordStatus = "broadcast" | "confirmed" | "failed" | "replaced";

/** Durable post-broadcast transaction state. */
export type TransactionRecord = {
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  accountKey: string;
  status: TransactionRecordStatus;
  submitted: TransactionSubmitted;
  /** Null until receipt tracking resolves a terminal chain outcome. */
  receipt: TransactionReceipt | null;
  /** Shared identity for replacement-related records. */
  replacementKey: TransactionReplacementKey | null;
  replacedByRecordId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TransactionRecordView = TransactionRecord;
