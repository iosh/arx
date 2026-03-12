import type { ApprovalFlowRegistry } from "../../approvals/types.js";
import type { PermissionsState } from "../../controllers/permission/types.js";
import type { HandlerControllers } from "../../rpc/handlers/types.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import {
  type UiPermissionsSnapshot,
  UiPermissionsSnapshotSchema,
  type UiSnapshot,
  UiSnapshotSchema,
} from "../protocol/schemas.js";

const toUiPermissionsSnapshot = (state: PermissionsState): UiPermissionsSnapshot => {
  const origins: UiPermissionsSnapshot["origins"] = {};

  for (const [origin, originState] of Object.entries(state.origins)) {
    const namespaces: UiPermissionsSnapshot["origins"][string] = {};

    for (const [namespace, namespaceState] of Object.entries(originState)) {
      namespaces[namespace] = {
        chains: Object.fromEntries(
          Object.entries(namespaceState.chains).map(([chainRef, chainState]) => [
            chainRef,
            {
              accountIds: [...chainState.accountIds],
            },
          ]),
        ),
      };
    }

    origins[origin] = namespaces;
  }

  return UiPermissionsSnapshotSchema.parse({ origins });
};

export const buildUiSnapshot = (deps: {
  controllers: HandlerControllers;
  chainViews: Pick<
    ChainViewsService,
    "buildWalletNetworksSnapshot" | "findAvailableChainView" | "getApprovalReviewChainView" | "getSelectedChainView"
  >;
  session: BackgroundSessionServices;
  keyring: KeyringService;
  attention: { getSnapshot: () => UiSnapshot["attention"] };
  approvalFlowRegistry: Pick<ApprovalFlowRegistry, "present">;
}): UiSnapshot => {
  const { controllers, chainViews, session, keyring, attention, approvalFlowRegistry } = deps;

  const chain = chainViews.getSelectedChainView();
  const networks = chainViews.buildWalletNetworksSnapshot();
  const resolvedChain = chain.chainRef;

  const accountList = session.unlock.isUnlocked()
    ? controllers.accounts
        .listOwnedForNamespace({ namespace: chain.namespace, chainRef: resolvedChain })
        .map((account) => ({
          accountId: account.accountId,
          canonicalAddress: account.canonicalAddress,
          displayAddress: account.displayAddress,
        }))
    : [];
  const activeAccount = session.unlock.isUnlocked()
    ? controllers.accounts.getActiveAccountForNamespace({ namespace: chain.namespace, chainRef: resolvedChain })
    : null;

  const accountsState = controllers.accounts.getState();
  const totalCount = Object.values(accountsState.namespaces).reduce((sum, ns) => sum + ns.accountIds.length, 0);

  const approvalState = controllers.approvals.getState();
  const approvalSummaries = approvalState.pending
    .map((item) => {
      const record = controllers.approvals.get(item.id);
      if (!record) return null;

      try {
        return approvalFlowRegistry.present(record, {
          accounts: controllers.accounts,
          chainViews,
          transactions: controllers.transactions,
        });
      } catch {
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const keyringWarnings = keyring
    .getKeyrings()
    .filter((meta) => meta.type === "hd" && meta.needsBackup === true)
    .map((meta) => ({
      keyringId: meta.id,
      alias: meta.name ?? null,
    }));

  const snapshot: UiSnapshot = {
    chain: {
      chainRef: chain.chainRef,
      chainId: chain.chainId,
      namespace: chain.namespace,
      displayName: chain.displayName,
      shortName: chain.shortName ?? null,
      icon: chain.icon,
      nativeCurrency: {
        name: chain.nativeCurrency.name,
        symbol: chain.nativeCurrency.symbol,
        decimals: chain.nativeCurrency.decimals,
      },
    },
    networks: {
      ...networks,
    },
    accounts: {
      totalCount,
      list: accountList,
      active: activeAccount
        ? {
            accountId: activeAccount.accountId,
            canonicalAddress: activeAccount.canonicalAddress,
            displayAddress: activeAccount.displayAddress,
          }
        : null,
    },
    session: {
      isUnlocked: session.unlock.isUnlocked(),
      autoLockDurationMs: session.unlock.getState().timeoutMs,
      nextAutoLockAt: session.unlock.getState().nextAutoLockAt,
    },
    approvals: approvalSummaries,
    attention: attention.getSnapshot(),
    permissions: toUiPermissionsSnapshot(controllers.permissions.getState()),
    vault: {
      initialized: session.vault.getStatus().hasEnvelope,
    },
    warnings: {
      hdKeyringsNeedingBackup: keyringWarnings,
    },
  };

  return UiSnapshotSchema.parse(snapshot);
};
