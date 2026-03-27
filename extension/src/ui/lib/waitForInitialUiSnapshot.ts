import type { UiSnapshot } from "@arx/core/ui";
import { uiClient } from "./uiBridgeClient";

const INITIAL_UI_SNAPSHOT_TIMEOUT_MS = 5_000;

export const waitForInitialUiSnapshot = async (opts?: { timeoutMs?: number }): Promise<UiSnapshot> => {
  return await uiClient.waitForSnapshot({
    timeoutMs: opts?.timeoutMs ?? INITIAL_UI_SNAPSHOT_TIMEOUT_MS,
  });
};
