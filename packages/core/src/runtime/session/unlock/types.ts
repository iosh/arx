import type { Messenger, Unsubscribe } from "../../../messenger/index.js";
import type { UnlockVaultParams, VaultStatus } from "../../../vault/types.js";

export type UnlockReason = "manual" | "timeout" | "suspend" | "reload";

export type UninitializedSessionLockState = {
  status: "uninitialized";
  autoLockDurationMs: number;
  nextAutoLockAt: null;
};

export type LockedSessionLockState = {
  status: "locked";
  autoLockDurationMs: number;
  nextAutoLockAt: null;
};

export type UnlockedSessionLockState = {
  status: "unlocked";
  unlockedAt: number;
  autoLockDurationMs: number;
  nextAutoLockAt: number;
};

export type SessionLockState = UninitializedSessionLockState | LockedSessionLockState | UnlockedSessionLockState;

export type UnlockParams = UnlockVaultParams;

export type UnlockVaultPort = {
  unlock(params: UnlockParams): Promise<void>;
  lock(): void;
  getStatus(): VaultStatus;
};

export type UnlockLockedPayload = { at: number; reason: UnlockReason };
export type UnlockUnlockedPayload = { at: number };

export type UnlockServiceOptions = {
  messenger: Messenger;
  vault: UnlockVaultPort;
  autoLockDurationMs?: number;
  now?: () => number;
  timers?: {
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
  };
};

export interface UnlockService {
  getState(): SessionLockState;
  isUnlocked(): boolean;
  unlock(params: UnlockParams): Promise<void>;
  lock(reason: UnlockReason): void;
  syncVaultStatus(): SessionLockState;
  scheduleAutoLock(duration?: number): number | null;
  setAutoLockDuration(duration: number): void;
  onStateChanged(handler: (state: SessionLockState) => void): Unsubscribe;
  onLocked(handler: (payload: UnlockLockedPayload) => void): Unsubscribe;
  onUnlocked(handler: (payload: UnlockUnlockedPayload) => void): Unsubscribe;
}
