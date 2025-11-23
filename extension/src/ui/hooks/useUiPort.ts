import { useEffect } from "react";
import type { UiSnapshot } from "@arx/core/ui";
import { uiClient } from "../lib/uiClient";

export const useUiPort = (onEvent: (snapshot: UiSnapshot) => void) => {
  useEffect(() => {
    uiClient.connect();
    const unsubscribe = uiClient.onStateChanged(onEvent);
    return () => {
      unsubscribe();
    };
  }, [onEvent]);
};
