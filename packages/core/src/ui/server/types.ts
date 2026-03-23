import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import type { PermissionController } from "../../controllers/permission/types.js";
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
import type { UiSessionAccess } from "./sessionAccess.js";

export type { UiKeyringsAccess } from "./keyringsAccess.js";
export type { UiSessionAccess } from "./sessionAccess.js";

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

export type UiAccountsAccess = Pick<
  AccountController,
  "getState" | "listOwnedForNamespace" | "getActiveAccountForNamespace" | "setActiveAccount" | "onStateChanged"
>;

export type UiApprovalsAccess = Pick<ApprovalController, "getState" | "get" | "resolve" | "onStateChanged">;

export type UiPermissionsAccess = Pick<PermissionViewsService, "buildUiPermissionsSnapshot"> & {
  onStateChanged: Pick<PermissionController, "onStateChanged">["onStateChanged"];
};

export type UiTransactionsAccess = Pick<
  TransactionController,
  "beginTransactionApproval" | "getMeta" | "onStateChanged"
>;

export type UiChainsAccess = Pick<ChainActivationService, "selectWalletChain"> &
  Pick<
    ChainViewsService,
    | "buildWalletNetworksSnapshot"
    | "findAvailableChainView"
    | "getApprovalReviewChainView"
    | "getPreferredChainViewForNamespace"
    | "getSelectedChainView"
    | "requireAvailableChainMetadata"
  > & {
    onStateChanged: (listener: () => void) => () => void;
    onPreferencesChanged: (listener: () => void) => () => void;
  };

export type UiAccountCodecsAccess = Pick<AccountCodecRegistry, "get" | "toAccountKeyFromAddress">;

export type UiAttentionAccess = Pick<AttentionService, "getSnapshot"> & {
  onStateChanged: (listener: () => void) => () => void;
};

export type UiNamespaceBindingsAccess = Pick<
  NamespaceRuntimeBindingsRegistry,
  "getUi" | "hasTransaction" | "hasTransactionReceiptTracking"
>;

export type UiErrorEncoder = {
  encodeError: (error: unknown, context: { namespace: string; chainRef: string; method: string }) => UiError;
};

export type UiRuntimeDeps = {
  accounts: UiAccountsAccess;
  approvals: UiApprovalsAccess;
  permissions: UiPermissionsAccess;
  transactions: UiTransactionsAccess;
  chains: UiChainsAccess;
  accountCodecs: UiAccountCodecsAccess;
  session: UiSessionAccess;
  keyrings: UiKeyringsAccess;
  attention: UiAttentionAccess;
  namespaceBindings: UiNamespaceBindingsAccess;
  errorEncoder: UiErrorEncoder;
  uiOrigin: string;
  platform: UiPlatformAdapter;
};

export type UiHandlerDeps = Omit<UiRuntimeDeps, "attention" | "errorEncoder"> & {
  buildSnapshot: UiSnapshotBuilder;
  uiSessionId: string;
};

export type UiServerRuntime = {
  buildSnapshot: UiSnapshotBuilder;
  getUiContext: UiContextResolver;
  handlers: UiHandlers;
};

export type UiRuntimeDispatchResult = {
  reply: UiPortEnvelope;
  shouldBroadcastSnapshot: boolean;
};

export type UiRuntimeAccess = {
  buildSnapshotEvent: () => UiEventEnvelope;
  dispatchRequest: (raw: unknown) => Promise<UiRuntimeDispatchResult | null>;
  shouldHoldBroadcast: (raw: unknown) => boolean;
  subscribeStateChanged: (listener: () => void) => () => void;
};
