import { createApprovalFlowRegistry } from "../../approvals/index.js";
import type { AccountController } from "../../controllers/account/types.js";
import type { ApprovalController } from "../../controllers/approval/types.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../../namespaces/index.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { AttentionService } from "../../services/runtime/attention/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { KeyringExportService } from "../../services/runtime/keyringExport.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { SessionStatusService } from "../../services/runtime/sessionStatus.js";
import { createUiKeyringsAccess } from "../../ui/server/keyringsAccess.js";
import { createUiSessionAccess } from "../../ui/server/sessionAccess.js";
import { buildUiSnapshot } from "../../ui/server/snapshot.js";
import type { WalletDappConnections, WalletSnapshots } from "../types.js";
import { buildProviderSnapshot, type ProviderProjectionDeps } from "./providerProjection.js";

// Snapshot builders. They aggregate state but do not own it.
export const createWalletSnapshots = (deps: {
  session: BackgroundSessionServices;
  sessionStatus: SessionStatusService;
  keyring: KeyringService;
  keyringExport: KeyringExportService;
  attention: AttentionService;
  chainViews: Pick<
    ChainViewsService,
    "buildWalletNetworksSnapshot" | "findAvailableChainView" | "getApprovalReviewChainView" | "getSelectedChainView"
  >;
  permissionViews: Pick<PermissionViewsService, "buildUiPermissionsSnapshot">;
  accounts: Pick<
    AccountController,
    "getState" | "listOwnedForNamespace" | "getActiveAccountForNamespace" | "setActiveAccount"
  >;
  approvals: Pick<ApprovalController, "getState" | "get" | "resolve">;
  transactions: Pick<TransactionController, "getMeta">;
  namespaceBindings: Pick<
    NamespaceRuntimeBindingsRegistry,
    "getUi" | "hasTransaction" | "hasTransactionReceiptTracking"
  >;
  dappConnections: Pick<WalletDappConnections, "buildConnectionProjection">;
  providerProjection: ProviderProjectionDeps;
}): WalletSnapshots => {
  const {
    session,
    sessionStatus,
    keyring,
    keyringExport,
    attention,
    chainViews,
    permissionViews,
    accounts,
    approvals,
    transactions,
    namespaceBindings,
    dappConnections,
    providerProjection,
  } = deps;

  const approvalFlows = createApprovalFlowRegistry();
  const uiSessionAccess = createUiSessionAccess({
    session,
    sessionStatus,
    keyring,
  });
  const uiKeyringsAccess = createUiKeyringsAccess({
    keyring,
    keyringExport,
  });

  return {
    buildProviderSnapshot: (namespace) => buildProviderSnapshot(providerProjection, namespace),
    buildProviderConnectionState: (input) => {
      const { connected: _connected, ...state } = dappConnections.buildConnectionProjection(input);
      return state;
    },
    buildUiSnapshot: () =>
      buildUiSnapshot({
        accounts,
        approvals,
        chains: chainViews,
        permissions: permissionViews,
        session: uiSessionAccess,
        keyrings: uiKeyringsAccess,
        attention: {
          getSnapshot: () => attention.getSnapshot(),
        },
        namespaceBindings,
        transactions,
        approvalFlows,
      }),
  };
};
