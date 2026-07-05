import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { ApprovalCreatedEvent, ApprovalFinishedEvent, ApprovalState } from "./types.js";

export const APPROVAL_STATE_CHANGED = stateTopic<ApprovalState>("approval:stateChanged");

export const APPROVAL_CREATED = eventTopic<ApprovalCreatedEvent>("approval:created");

export const APPROVAL_FINISHED = eventTopic<ApprovalFinishedEvent>("approval:finished");
