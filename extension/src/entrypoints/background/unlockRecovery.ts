import type { UnlockController } from "@arx/core";

export type UnlockStateSnapshot = {
  isUnlocked: boolean;
  lastUnlockedAt: number | null;
  nextAutoLockAt: number | null;
};

type RestoreUnlockStateOptions = {
  controller: Pick<UnlockController, "getState" | "isUnlocked" | "lock" | "scheduleAutoLock">;
  snapshot: UnlockStateSnapshot;
  snapshotCapturedAt: number;
  now: () => number;
};
const MINIMUM_TIMER_MS = 1;

export const restoreUnlockState = ({ controller, snapshot, snapshotCapturedAt, now }: RestoreUnlockStateOptions) => {
  const current = controller.getState();
  const isCurrentlyUnlocked = controller.isUnlocked();
  const nowTs = now();
  const elapsedSinceSnapshot = Math.max(0, nowTs - snapshotCapturedAt);

  if (!snapshot.isUnlocked) {
    if (isCurrentlyUnlocked) {
      controller.lock("suspend");
    }
    return;
  }

  if (!isCurrentlyUnlocked) {
    return;
  }

  if (elapsedSinceSnapshot >= current.timeoutMs) {
    controller.lock("timeout");
    return;
  }

  const baseDeadline =
    snapshot.nextAutoLockAt ?? (snapshot.lastUnlockedAt === null ? null : snapshot.lastUnlockedAt + current.timeoutMs);

  if (baseDeadline === null) {
    controller.scheduleAutoLock(current.timeoutMs);
    return;
  }

  let remaining = baseDeadline - nowTs;
  if (remaining <= 0) {
    controller.lock("timeout");
    return;
  }

  remaining = Math.min(remaining, current.timeoutMs);
  controller.scheduleAutoLock(Math.max(MINIMUM_TIMER_MS, Math.round(remaining)));
};
