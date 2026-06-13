import type { NamespaceRuntimeBindingsRegistry } from "../../namespaces/index.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { AttentionService } from "../../services/runtime/attention/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { SessionStatusService } from "../../services/runtime/sessionStatus.js";
import { createUiSessionAccess } from "../../ui/server/sessionAccess.js";
import { buildUiSnapshot } from "../../ui/server/snapshot.js";
import type { UiApprovalsAccess } from "../../ui/server/types.js";
import type { WalletAccounts, WalletSnapshots } from "../types.js";

export const createWalletSnapshots = (deps: {
  session: BackgroundSessionServices;
  sessionStatus: SessionStatusService;
  keyring: KeyringService;
  attention: AttentionService;
  chainViews: Pick<
    ChainViewsService,
    "buildWalletNetworksSnapshot" | "findAvailableChainView" | "getApprovalReviewChainView" | "getSelectedChainView"
  >;
  permissionViews: Pick<PermissionViewsService, "buildUiPermissionsSnapshot">;
  accounts: Pick<
    WalletAccounts,
    "getState" | "listOwnedForNamespace" | "getActiveAccountForNamespace" | "getKeyrings" | "setActiveAccount"
  >;
  approvals: UiApprovalsAccess;
  namespaceBindings: Pick<
    NamespaceRuntimeBindingsRegistry,
    "getUi" | "hasTransaction" | "hasTransactionReceiptTracking"
  >;
}): WalletSnapshots => {
  const { session, sessionStatus, keyring, attention, chainViews, permissionViews, accounts, namespaceBindings } = deps;
  const uiSessionAccess = createUiSessionAccess({
    session,
    sessionStatus,
    keyring,
  });

  return {
    buildUiSnapshot: () =>
      buildUiSnapshot({
        accounts,
        chains: chainViews,
        permissions: permissionViews,
        session: uiSessionAccess,
        keyrings: accounts,
        attention: {
          getSnapshot: () => attention.getSnapshot(),
        },
        namespaceBindings,
      }),
  };
};
