import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../../namespaces/index.js";
import type { AttentionService } from "../../services/runtime/attention/index.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type {
  TransactionApprovalsChangedHandler,
  TransactionsChangedHandler,
} from "../../transactions/TransactionsService.js";
import type { TrustedWalletApi } from "../../wallet/api.js";
import type { UiEventEnvelope, UiPortEnvelope } from "../protocol/envelopes.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../protocol/index.js";
import type { ApprovalDetail, ApprovalListEntry } from "../protocol/models/approvals.js";
import type { UiApprovalResolveResult } from "./approvals/resolveService.js";

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

export type UiContextResolver = () => UiResolvedContext;

export type UiAccountsAccess = Pick<
  AccountSelectionService,
  "getState" | "listOwnedForNamespace" | "getActiveAccountForNamespace" | "setActiveAccount"
>;

export type UiApprovalsReadModelAccess = {
  listPendingEntries(): Awaitable<ApprovalListEntry[]>;
  getDetail(id: string): Awaitable<ApprovalDetail | null>;
};

export type UiApprovalsWriteAccess = {
  resolve(input: UiMethodParams<"ui.approvals.resolve">): Awaitable<UiApprovalResolveResult>;
};

export type UiApprovalsAccess = {
  read: UiApprovalsReadModelAccess;
  write: UiApprovalsWriteAccess;
};

export type UiPermissionsAccess = Pick<PermissionViewsService, "buildUiPermissionsSnapshot">;

export type UiChainsAccess = Pick<ChainActivationService, "selectWalletChain"> &
  Pick<
    ChainViewsService,
    | "buildWalletNetworksSnapshot"
    | "findAvailableChainView"
    | "getApprovalReviewChainView"
    | "getActiveChainViewForNamespace"
    | "getSelectedNamespace"
    | "getSelectedChainView"
    | "requireAvailableChainDefinition"
  >;

export type UiAttentionAccess = Pick<AttentionService, "getSnapshot">;

export type UiNamespaceBindingsAccess = Pick<
  NamespaceRuntimeBindingsRegistry,
  "getUi" | "hasTransactionReceiptTracking"
>;

export type UiEventSource = {
  onSessionChanged(listener: () => void): () => void;
  onApprovalCreated(listener: () => void): () => void;
  onApprovalFinished(listener: (event: { approvalId: string }) => void): () => void;
  onTransactionApprovalsChanged(handler: TransactionApprovalsChangedHandler): () => void;
  onTransactionsChanged(handler: TransactionsChangedHandler): () => void;
};

export type UiSurfaceIdentity = {
  transport: "ui";
  portId: string;
  origin: string;
  surfaceId: string;
};

export type UiRuntimeServerDeps = {
  wallet: TrustedWalletApi;
  events: UiEventSource;
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
  subscribeUiEvents: (listener: (event: UiEventEnvelope) => void) => () => void;
};
