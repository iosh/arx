import type { Unsubscribe } from "../../messenger/topic.js";
import type { UnlockVaultParams } from "../../vault/types.js";
import type { UnlockMessenger } from "./topics.js";

export type UnlockReason = "manual" | "timeout" | "blur" | "suspend" | "reload";

export type UnlockState = {
  isUnlocked: boolean;
  lastUnlockedAt: number | null;
  timeoutMs: number;
  nextAutoLockAt: number | null;
};

export type UnlockParams = UnlockVaultParams;

export type UnlockVaultPort = {
  unlock(params: UnlockParams): Promise<void>;
  lock(): void;
  isUnlocked(): boolean;
};

export type UnlockLockedPayload = { at: number; reason: UnlockReason };
export type UnlockUnlockedPayload = { at: number };

export type UnlockControllerOptions = {
  messenger: UnlockMessenger;
  vault: UnlockVaultPort;
  autoLockDurationMs?: number;
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
