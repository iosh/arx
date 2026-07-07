import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { AttentionRequest, AttentionState } from "./types.js";

export const ATTENTION_REQUESTED = eventTopic<AttentionRequest>("attention:requested");

export const ATTENTION_STATE_CHANGED = stateTopic<AttentionState>("attention:stateChanged");
