import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { UnlockLockedPayload, UnlockState, UnlockUnlockedPayload } from "./types.js";

export const UNLOCK_STATE_CHANGED = stateTopic<UnlockState>("unlock:stateChanged", {
  isEqual: (prev, next) =>
    prev.isUnlocked === next.isUnlocked &&
    prev.lastUnlockedAt === next.lastUnlockedAt &&
    prev.timeoutMs === next.timeoutMs &&
    prev.nextAutoLockAt === next.nextAutoLockAt,
});

export const UNLOCK_LOCKED = eventTopic<UnlockLockedPayload>("unlock:locked");
export const UNLOCK_UNLOCKED = eventTopic<UnlockUnlockedPayload>("unlock:unlocked");

export const UNLOCK_TOPICS = [UNLOCK_STATE_CHANGED, UNLOCK_LOCKED, UNLOCK_UNLOCKED] as const;

export type UnlockMessenger = ScopedMessenger<typeof UNLOCK_TOPICS>;
