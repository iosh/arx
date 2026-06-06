import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { ApprovalCreatedEvent, ApprovalFinishedEvent, ApprovalState } from "./types.js";
import { isSameState } from "./utils.js";

export const APPROVAL_STATE_CHANGED = stateTopic<ApprovalState>("approval:stateChanged", {
  isEqual: (prev, next) => isSameState(prev, next),
});

export const APPROVAL_CREATED = eventTopic<ApprovalCreatedEvent>("approval:created");

export const APPROVAL_FINISHED = eventTopic<ApprovalFinishedEvent<unknown>>("approval:finished");

export const APPROVAL_TOPICS = [APPROVAL_STATE_CHANGED, APPROVAL_CREATED, APPROVAL_FINISHED] as const;

export type ApprovalMessenger = ScopedMessenger<typeof APPROVAL_TOPICS>;
