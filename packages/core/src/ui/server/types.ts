import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { NamespaceRuntimeBindingsRegistry } from "../../namespaces/index.js";
import type { HandlerControllers } from "../../rpc/handlers/types.js";
import type { RpcRegistry } from "../../rpc/index.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { AttentionService } from "../../services/runtime/attention/index.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../protocol/index.js";
import type { UiSnapshot } from "../protocol/schemas.js";

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

export type UiSnapshotBuilder = () => UiSnapshot;

export type UiResolvedContext = {
  namespace: string;
  chainRef: string;
};

export type UiContextResolver = () => UiResolvedContext;

export type UiRuntimeDeps = {
  controllers: HandlerControllers;
  chainActivation: Pick<ChainActivationService, "selectWalletChain">;
  chainViews: Pick<
    ChainViewsService,
    | "buildProviderMeta"
    | "buildWalletNetworksSnapshot"
    | "findAvailableChainView"
    | "getApprovalReviewChainView"
    | "getPreferredChainViewForNamespace"
    | "getProviderChainView"
    | "getSelectedChainView"
    | "listAvailableChainViews"
    | "listKnownChainViews"
    | "requireAvailableChainMetadata"
  >;
  permissionViews: Pick<PermissionViewsService, "buildUiPermissionsSnapshot">;
  accountCodecs: Pick<AccountCodecRegistry, "get" | "toAccountIdFromAddress">;
  session: BackgroundSessionServices;
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
  namespaceBindings: Pick<NamespaceRuntimeBindingsRegistry, "getUi" | "hasTransaction">;
  rpcRegistry: Pick<RpcRegistry, "encodeErrorWithAdapters">;
  uiOrigin: string;
  platform: UiPlatformAdapter;
};

export type UiHandlerDeps = Omit<UiRuntimeDeps, "rpcRegistry"> & {
  buildSnapshot: UiSnapshotBuilder;
  uiSessionId: string;
};

export type UiServerRuntime = {
  buildSnapshot: UiSnapshotBuilder;
  getUiContext: UiContextResolver;
  handlers: UiHandlers;
};
