import type { UiHandlers, UiRuntimeDeps } from "../types.js";

export const createAttentionHandlers = (
  deps: Pick<UiRuntimeDeps, "platform">,
): Pick<UiHandlers, "ui.attention.openNotification"> => {
  return {
    "ui.attention.openNotification": async () => {
      return await deps.platform.openNotificationPopup();
    },
  };
};
