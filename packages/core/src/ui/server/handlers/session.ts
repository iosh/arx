import type { UiHandlers, UiRuntimeDeps } from "../types.js";

export const createSessionHandlers = (
  deps: Pick<UiRuntimeDeps, "session" | "keyring">,
): Pick<
  UiHandlers,
  "ui.session.unlock" | "ui.session.lock" | "ui.session.resetAutoLockTimer" | "ui.session.setAutoLockDuration"
> => {
  return {
    "ui.session.unlock": async ({ password }) => {
      await deps.session.unlock.unlock({ password });
      await deps.keyring.waitForReady();
      return deps.session.unlock.getState();
    },

    "ui.session.lock": async (payload) => {
      deps.session.unlock.lock(payload?.reason ?? "manual");
      return deps.session.unlock.getState();
    },

    "ui.session.resetAutoLockTimer": async () => {
      deps.session.unlock.scheduleAutoLock();
      return deps.session.unlock.getState();
    },

    "ui.session.setAutoLockDuration": async ({ durationMs }) => {
      deps.session.unlock.setAutoLockDuration(durationMs);
      const state = deps.session.unlock.getState();
      return { autoLockDurationMs: state.timeoutMs, nextAutoLockAt: state.nextAutoLockAt };
    },
  };
};
