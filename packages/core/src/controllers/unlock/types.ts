import type { ControllerMessenger, Unsubscribe } from "../../messenger/ControllerMessenger.js";
import type { UnlockVaultParams, VaultService } from "../../vault/types.js";

export type UnlockReason = "manual" | "timeout" | "blur" | "suspend" | "reload";

export type UnlockState = {
  isUnlocked: boolean;
  lastUnlockedAt: number | null;
  timeoutMs: number;
  nextAutoLockAt: number | null;
};

export type UnlockParams = UnlockVaultParams;

export type UnlockLockedPayload = { at: number; reason: UnlockReason };
export type UnlockUnlockedPayload = { at: number };

export type UnlockMessengerTopics = {
  "session:stateChanged": UnlockState;
  "session:locked": UnlockLockedPayload;
  "session:unlocked": UnlockUnlockedPayload;
};

export type UnlockControllerOptions = {
  messenger: ControllerMessenger<UnlockMessengerTopics>;
  vault: Pick<VaultService, "unlock" | "lock" | "isUnlocked">;
  autoLockDuration?: number;
  now?: () => number;
  timers?: {
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
  };
};

export interface UnlockController {
  getState(): UnlockState;
  isUnlocked(): boolean;
  unlock(params: UnlockParams): Promise<void>;
  lock(reason: UnlockReason): void;
  scheduleAutoLock(duration?: number): number | null;
  setAutoLockDuration(duration: number): void;
  onStateChanged(handler: (state: UnlockState) => void): Unsubscribe;
  onLocked(handler: (payload: UnlockLockedPayload) => void): Unsubscribe;
  onUnlocked(handler: (payload: UnlockUnlockedPayload) => void): Unsubscribe;
}
