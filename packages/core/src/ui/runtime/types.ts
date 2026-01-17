import type { AttentionService } from "../../services/attention/index.js";
import type { HandlerControllers } from "../../rpc/handlers/types.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";

export type UiOnboardingOpenTabResult = {
  activationPath: "focus" | "create" | "debounced";
  tabId?: number;
};

export type UiPlatformAdapter = {
  openOnboardingTab: (reason: string) => Promise<UiOnboardingOpenTabResult>;
};

export type UiRuntimeDeps = {
  controllers: HandlerControllers;
  session: BackgroundSessionServices;
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
  platform: UiPlatformAdapter;
};

