import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import type { ApprovalQueueService } from "../../approvals/queue/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../../namespaces/index.js";
import type { PermissionsEvents } from "../../permissions/service/types.js";
import type { AttentionService } from "../../services/runtime/attention/index.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { TransactionsService } from "../../transactions/TransactionsService.js";
import type { UiError, UiEventEnvelope, UiPortEnvelope } from "../protocol/envelopes.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "../protocol/index.js";
import type { ApprovalDetail, ApprovalListEntry } from "../protocol/models/approvals.js";
import type { UiSnapshot } from "../protocol/schemas.js";
import type { UiApprovalResolveResult } from "./approvals/resolveService.js";
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

export type UiApprovalEventsAccess = {
  onCreated: ApprovalQueueService["onCreated"];
  onFinished: ApprovalQueueService["onFinished"];
};

export type UiPermissionsAccess = Pick<PermissionViewsService, "buildUiPermissionsSnapshot">;

export type UiTransactionsAccess = Pick<
  TransactionsService,
  | "requestTransactionApproval"
  | "rerunApprovalPrepare"
  | "updateApprovalDraft"
  | "approveAndSubmitTransaction"
  | "rejectTransactionApproval"
  | "getTransactionApproval"
  | "getTransactionApprovalByTransactionId"
  | "getTransaction"
  | "listTransactions"
  | "onTransactionsChanged"
  | "onTransactionApprovalsChanged"
>;

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
  approvalEvents: UiApprovalEventsAccess;
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
  accounts: Pick<AccountSelectionService, "onStateChanged">;
  permissions: {
    onStateChanged: PermissionsEvents["onStateChanged"];
  };
  chains: {
    onStateChanged: UiStateChangeSubscription;
    onSelectionChanged: UiStateChangeSubscription;
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
  createId?: () => string;
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
  subscribeUiEvents: (listener: (event: UiEventEnvelope) => void) => () => void;
};
