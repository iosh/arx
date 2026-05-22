import type { ScopedMessenger } from "../messenger/Messenger.js";
import { eventTopic } from "../messenger/topic.js";
import type {
  ApprovalDetailInvalidation,
  TransactionBroadcastStartedChange,
  TransactionStatusChange,
  TransactionSubmittedChange,
} from "./events.js";

export const TRANSACTION_STATUS_CHANGED = eventTopic<TransactionStatusChange>("transaction:statusChanged");

export const TRANSACTION_APPROVAL_DETAIL_INVALIDATED = eventTopic<ApprovalDetailInvalidation>(
  "transaction:approvalDetailInvalidated",
);

export const TRANSACTION_SUBMITTED = eventTopic<TransactionSubmittedChange>("transaction:submitted");

export const TRANSACTION_BROADCAST_STARTED =
  eventTopic<TransactionBroadcastStartedChange>("transaction:broadcastStarted");

export const TRANSACTION_TOPICS = [
  TRANSACTION_STATUS_CHANGED,
  TRANSACTION_APPROVAL_DETAIL_INVALIDATED,
  TRANSACTION_BROADCAST_STARTED,
  TRANSACTION_SUBMITTED,
] as const;

export type TransactionMessenger = ScopedMessenger<typeof TRANSACTION_TOPICS>;
