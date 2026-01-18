import type { UiClient } from "@arx/core/ui";
import { createUiClient, uiActions as uiActionsExt } from "@arx/core/ui";
import { createUiPortTransport } from "./uiPortTransport";

const transport = createUiPortTransport();

const baseClient: UiClient = createUiClient({
  transport,
  logger: console,
});

export const uiClient = baseClient.extend(uiActionsExt);
