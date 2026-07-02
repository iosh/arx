import { eventTopic, stateTopic } from "../../../messenger/topic.js";
import type { SessionLockState, UnlockLockedPayload, UnlockUnlockedPayload } from "./types.js";

export const UNLOCK_STATE_CHANGED = stateTopic<SessionLockState>("unlock:stateChanged");

export const UNLOCK_LOCKED = eventTopic<UnlockLockedPayload>("unlock:locked");
export const UNLOCK_UNLOCKED = eventTopic<UnlockUnlockedPayload>("unlock:unlocked");
