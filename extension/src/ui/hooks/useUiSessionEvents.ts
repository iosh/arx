import { UI_EVENT_SESSION_CHANGED } from "@arx/core/ui";
import { useEffect } from "react";
import { uiClient } from "../lib/uiBridgeClient";

export const useUiSessionEvents = (onChanged: () => void) => {
  useEffect(() => {
    const unsubscribe = uiClient.on(UI_EVENT_SESSION_CHANGED, onChanged);
    return () => {
      unsubscribe();
    };
  }, [onChanged]);
};
