import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { AttentionRequest, AttentionState } from "./types.js";

export const ATTENTION_REQUESTED = eventTopic<AttentionRequest>("attention:requested");

export const ATTENTION_STATE_CHANGED = stateTopic<AttentionState>("attention:stateChanged");

export const ATTENTION_TOPICS = [ATTENTION_REQUESTED, ATTENTION_STATE_CHANGED] as const;

export type AttentionMessenger = ScopedMessenger<typeof ATTENTION_TOPICS>;
