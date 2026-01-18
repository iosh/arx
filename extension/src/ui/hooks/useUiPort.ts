import type { UiSnapshot } from "@arx/core/ui";
import { UI_EVENT_SNAPSHOT_CHANGED } from "@arx/core/ui";
import { useEffect } from "react";
import { uiClient } from "../lib/uiBridgeClient";

export const useUiPort = (onEvent: (snapshot: UiSnapshot) => void) => {
  useEffect(() => {
    const unsubscribe = uiClient.on(UI_EVENT_SNAPSHOT_CHANGED, onEvent);
    return () => {
      unsubscribe();
    };
  }, [onEvent]);
};
