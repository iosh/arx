import type { HandlerControllers } from "../../rpc/handlers/types.js";
import type { RpcRegistry } from "../../rpc/index.js";
import type { RpcClientRegistry } from "../../rpc/RpcClientRegistry.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { AttentionService } from "../../services/runtime/attention/index.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../protocol/index.js";

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

export type UiRuntimeDeps = {
  controllers: HandlerControllers;
  chainActivation: Pick<ChainActivationService, "activate">;
  chainViews: Pick<
    ChainViewsService,
    | "buildProviderMeta"
    | "buildUiNetworksSnapshot"
    | "findAvailableChainView"
    | "getActiveChainView"
    | "listAvailableChainViews"
    | "listKnownChainViews"
    | "requireAvailableChainMetadata"
  >;
  session: BackgroundSessionServices;
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
  rpcClients: Pick<RpcClientRegistry, "getClient">;
  rpcRegistry: Pick<RpcRegistry, "encodeErrorWithAdapters">;
  uiOrigin: string;
  platform: UiPlatformAdapter;
};
