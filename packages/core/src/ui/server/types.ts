import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import type { PermissionsEvents } from "../../controllers/permission/types.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../../namespaces/index.js";
import type { AttentionService } from "../../services/runtime/attention/index.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { UiError, UiEventEnvelope, UiPortEnvelope } from "../protocol/envelopes.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../protocol/index.js";
import type { UiSnapshot } from "../protocol/schemas.js";
import type { UiKeyringsAccess } from "./keyringsAccess.js";
import type { UiSessionAccess, UiStateChangeSubscription } from "./sessionAccess.js";
import type { UiWalletSetupAccess } from "./walletSetupAccess.js";

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

export type UiSnapshotBuilder = () => UiSnapshot;

export type UiResolvedContext = {
  namespace: string;
  chainRef: string;
};

export type UiContextResolver = () => UiResolvedContext;

export type UiAccountsAccess = Pick<
  AccountController,
  "getState" | "listOwnedForNamespace" | "getActiveAccountForNamespace" | "setActiveAccount"
>;

export type UiApprovalsAccess = Pick<ApprovalController, "getState" | "get" | "resolve">;

export type UiPermissionsAccess = Pick<PermissionViewsService, "buildUiPermissionsSnapshot">;

export type UiTransactionsAccess = Pick<TransactionController, "beginTransactionApproval" | "getMeta">;

export type UiChainsAccess = Pick<ChainActivationService, "selectWalletChain"> &
  Pick<
    ChainViewsService,
    | "buildWalletNetworksSnapshot"
    | "findAvailableChainView"
    | "getApprovalReviewChainView"
    | "getActiveChainViewForNamespace"
    | "getSelectedNamespace"
    | "getSelectedChainView"
    | "requireAvailableChainMetadata"
  >;

export type UiAccountCodecsAccess = Pick<AccountCodecRegistry, "get" | "toAccountKeyFromAddress">;

export type UiAttentionAccess = Pick<AttentionService, "getSnapshot">;

export type UiNamespaceBindingsAccess = Pick<
  NamespaceRuntimeBindingsRegistry,
  "getUi" | "hasTransaction" | "hasTransactionReceiptTracking"
>;

export type UiEncodeError = (
  error: unknown,
  context: { namespace: string; chainRef: string; method: string },
) => UiError;

export type UiServerAccess = {
  accounts: UiAccountsAccess;
  approvals: UiApprovalsAccess;
  permissions: UiPermissionsAccess;
  transactions: UiTransactionsAccess;
  chains: UiChainsAccess;
  accountCodecs: UiAccountCodecsAccess;
  session: UiSessionAccess;
  walletSetup: UiWalletSetupAccess;
  keyrings: UiKeyringsAccess;
  attention: UiAttentionAccess;
  namespaceBindings: UiNamespaceBindingsAccess;
};

export type UiSurfaceIdentity = {
  transport: "ui";
  portId: string;
  origin: string;
  surfaceId: string;
};

export type UiStateChangeSources = {
  accounts: Pick<AccountController, "onStateChanged">;
  approvals: Pick<ApprovalController, "onStateChanged">;
  permissions: {
    onStateChanged: PermissionsEvents["onStateChanged"];
  };
  transactions: Pick<TransactionController, "onStateChanged">;
  chains: {
    onStateChanged: UiStateChangeSubscription;
    onPreferencesChanged: UiStateChangeSubscription;
  };
  session: Pick<UiSessionAccess, "onStateChanged">;
  attention: {
    onStateChanged: UiStateChangeSubscription;
  };
};

export type UiRuntimeBridgeAccess = {
  encodeError: UiEncodeError;
  persistVaultMeta: () => Promise<void>;
  stateChanged: UiStateChangeSources;
};

export type UiRuntimeServerDeps = {
  access: UiServerAccess;
  platform: UiPlatformAdapter;
  uiOrigin: string;
  extensions?: readonly UiServerExtension[];
};

export type UiServerRuntimeDeps = {
  access: UiServerAccess;
  platform: UiPlatformAdapter;
  surface: UiSurfaceIdentity;
  extensions?: readonly UiServerExtension[];
};

export type UiRuntimeDeps = {
  server: UiRuntimeServerDeps;
  bridge: UiRuntimeBridgeAccess;
};

export type UiHandlerDeps = {
  access: UiServerAccess;
  platform: UiPlatformAdapter;
  surface: UiSurfaceIdentity;
  buildSnapshot: UiSnapshotBuilder;
};

export type UiServerExtension = {
  id: string;
  createHandlers: (deps: UiHandlerDeps) => UiMethodHandlerMap;
};

export type UiServerRuntime = {
  buildSnapshot: UiSnapshotBuilder;
  getUiContext: UiContextResolver;
  handlers: UiMethodHandlerMap;
};

export type UiRuntimeDispatchResult = {
  reply: UiPortEnvelope;
  shouldBroadcastSnapshot: boolean;
};

export type UiRuntimeAccess = {
  buildSnapshotEvent: () => UiEventEnvelope;
  dispatchRequest: (raw: unknown) => Promise<UiRuntimeDispatchResult | null>;
  getRequestBroadcastPolicy: (raw: unknown) => {
    holdBroadcast: boolean;
    fenceSnapshotBroadcast: boolean;
  };
  subscribeStateChanged: UiStateChangeSubscription;
};
