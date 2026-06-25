import type { TrustedWalletApi } from "../../wallet/api.js";
import type { UiPortEnvelope } from "../protocol/envelopes.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../protocol/index.js";

export type { SessionStatus } from "../../services/runtime/sessionStatus.js";
export type { UiKeyringsAccess } from "./keyringsAccess.js";
export type { UiSessionAccess, UiStateChangeSubscription } from "./sessionAccess.js";
export type { UiWalletSetupAccess } from "./walletSetupAccess.js";

export type UiOnboardingOpenTabResult = {
  activationPath: "focus" | "create" | "debounced";
  tabId?: number;
};

export type UiPlatformAdapter = {
  openOnboardingTab: (reason: string) => Promise<UiOnboardingOpenTabResult>;
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

export type UiMethodHandlerMap = Partial<UiHandlers>;

export type UiResolvedContext = {
  namespace: string;
  chainRef: string;
};

export type UiContextResolver = () => Promise<UiResolvedContext>;

export type UiSurfaceIdentity = {
  transport: "ui";
  portId: string;
  origin: string;
  surfaceId: string;
};

export type UiRuntimeServerDeps = {
  wallet: TrustedWalletApi;
  platform: UiPlatformAdapter;
  uiOrigin: string;
  createId?: () => string;
  extensions?: readonly UiServerExtension[];
};

export type UiServerRuntimeDeps = {
  wallet: TrustedWalletApi;
  platform: UiPlatformAdapter;
  surface: UiSurfaceIdentity;
  extensions?: readonly UiServerExtension[];
};

export type UiRuntimeDeps = {
  server: UiRuntimeServerDeps;
};

export type UiHandlerDeps = {
  wallet: TrustedWalletApi;
  platform: UiPlatformAdapter;
  surface: UiSurfaceIdentity;
};

export type UiServerExtension = {
  id: string;
  createHandlers: (deps: UiHandlerDeps) => UiMethodHandlerMap;
};

export type UiServerRuntime = {
  getUiContext: UiContextResolver;
  handlers: UiMethodHandlerMap;
};

export type UiRuntimeDispatchResult = {
  reply: UiPortEnvelope;
  kind: "query" | "command";
};

export type UiRuntimeAccess = {
  dispatchRequest: (raw: unknown) => Promise<UiRuntimeDispatchResult | null>;
};
