import type { HandlerControllers } from "../../rpc/handlers/types.js";
import type { RpcClientRegistry } from "../../rpc/RpcClientRegistry.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { AttentionService } from "../../services/attention/index.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../protocol.js";

/**
 * Result of opening the onboarding tab
 * - activationPath: how the tab was activated/focused
 * - tabId: browser tab ID if created/focused
 */
export type UiOnboardingOpenTabResult = {
  activationPath: "focus" | "create" | "debounced";
  tabId?: number;
};

/**
 * Platform-specific adapter for UI operations
 * Implemented differently in extension vs app environments
 */
export type UiPlatformAdapter = {
  /** Open or focus the onboarding tab/screen */
  openOnboardingTab: (reason: string) => Promise<UiOnboardingOpenTabResult>;

  /** Open or focus the confirmation/notification popup window (extension only) */
  openNotificationPopup: () => Promise<{
    activationPath: "focus" | "create" | "debounced";
    windowId?: number;
  }>;
};

type Awaitable<T> = T | Promise<T>;

export type UiHandlerFn<M extends UiMethodName> =
  undefined extends UiMethodParams<M>
    ? (params?: UiMethodParams<M>) => Awaitable<UiMethodResult<M>>
    : (params: UiMethodParams<M>) => Awaitable<UiMethodResult<M>>;

export type UiHandlers = {
  [M in UiMethodName]: UiHandlerFn<M>;
};

export type UiRuntimeDeps = {
  controllers: HandlerControllers;
  session: BackgroundSessionServices;
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
  rpcClients: Pick<RpcClientRegistry, "getClient">;
  /**
   * Origin used for UI-initiated requests (e.g. creating approvals from the wallet UI).
   * Must be a valid URL origin string (e.g. "chrome-extension://<id>").
   */
  uiOrigin: string;
  platform: UiPlatformAdapter;
};
