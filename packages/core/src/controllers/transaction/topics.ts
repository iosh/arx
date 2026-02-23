import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic } from "../../messenger/topic.js";
import type { TransactionStateChange, TransactionStatusChange } from "./types.js";

export const TRANSACTION_STATUS_CHANGED = eventTopic<TransactionStatusChange>("transaction:statusChanged");

export const TRANSACTION_STATE_CHANGED = eventTopic<TransactionStateChange>("transaction:stateChanged");

export const TRANSACTION_TOPICS = [TRANSACTION_STATUS_CHANGED, TRANSACTION_STATE_CHANGED] as const;

export type TransactionMessenger = ScopedMessenger<typeof TRANSACTION_TOPICS>;
