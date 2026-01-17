import type { UiSnapshot } from "@arx/core/ui";
import { useEffect } from "react";
import { uiClient } from "../lib/uiClient";

export const useUiPort = (onEvent: (snapshot: UiSnapshot) => void) => {
  useEffect(() => {
    uiClient.connect();
    const unsubscribe = uiClient.onSnapshotChanged(onEvent);
    return () => {
      unsubscribe();
    };
  }, [onEvent]);
};
