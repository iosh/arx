import type { UiHandlers, UiSessionAccess } from "../types.js";

export const createSessionHandlers = (deps: {
  session: UiSessionAccess;
}): Pick<
  UiHandlers,
  "ui.session.unlock" | "ui.session.lock" | "ui.session.resetAutoLockTimer" | "ui.session.setAutoLockDuration"
> => {
  return {
    "ui.session.unlock": async ({ password }) => {
      return await deps.session.unlock({ password });
    },

    "ui.session.lock": async (payload) => {
      return deps.session.lock(payload?.reason ?? "manual");
    },

    "ui.session.resetAutoLockTimer": async () => {
      return deps.session.resetAutoLockTimer();
    },

    "ui.session.setAutoLockDuration": async ({ durationMs }) => {
      return deps.session.setAutoLockDuration(durationMs);
    },
  };
};
