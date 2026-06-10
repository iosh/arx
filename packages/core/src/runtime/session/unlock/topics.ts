import type { ScopedMessenger } from "../../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../../messenger/topic.js";
import type { SessionLockState, UnlockLockedPayload, UnlockUnlockedPayload } from "./types.js";

const areSessionLockStatesEqual = (prev: SessionLockState, next: SessionLockState) => {
  if (prev.status !== next.status) return false;
  if (prev.autoLockDurationMs !== next.autoLockDurationMs) return false;
  if (prev.nextAutoLockAt !== next.nextAutoLockAt) return false;

  if (prev.status === "unlocked" && next.status === "unlocked") {
    return prev.unlockedAt === next.unlockedAt;
  }

  return true;
};

export const UNLOCK_STATE_CHANGED = stateTopic<SessionLockState>("unlock:stateChanged", {
  isEqual: areSessionLockStatesEqual,
});

export const UNLOCK_LOCKED = eventTopic<UnlockLockedPayload>("unlock:locked");
export const UNLOCK_UNLOCKED = eventTopic<UnlockUnlockedPayload>("unlock:unlocked");

export const UNLOCK_TOPICS = [UNLOCK_STATE_CHANGED, UNLOCK_LOCKED, UNLOCK_UNLOCKED] as const;

export type UnlockMessenger = ScopedMessenger<typeof UNLOCK_TOPICS>;
