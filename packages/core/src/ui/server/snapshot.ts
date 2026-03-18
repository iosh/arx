import type { ApprovalFlowRegistry } from "../../approvals/types.js";
import { type UiSnapshot, UiSnapshotSchema } from "../protocol/schemas.js";
import type {
  UiAccountsAccess,
  UiApprovalsAccess,
  UiAttentionAccess,
  UiChainsAccess,
  UiKeyringsAccess,
  UiNamespaceBindingsAccess,
  UiPermissionsAccess,
  UiSessionAccess,
  UiTransactionsAccess,
} from "./types.js";

export const buildUiSnapshot = (deps: {
  accounts: UiAccountsAccess;
  approvals: UiApprovalsAccess;
  chains: Pick<
    UiChainsAccess,
    "buildWalletNetworksSnapshot" | "findAvailableChainView" | "getApprovalReviewChainView" | "getSelectedChainView"
  >;
  permissions: Pick<UiPermissionsAccess, "buildUiPermissionsSnapshot">;
  session: UiSessionAccess;
  keyrings: Pick<UiKeyringsAccess, "getKeyrings">;
  attention: Pick<UiAttentionAccess, "getSnapshot">;
  namespaceBindings: UiNamespaceBindingsAccess;
  transactions: Pick<UiTransactionsAccess, "getMeta">;
  approvalFlowRegistry: Pick<ApprovalFlowRegistry, "present">;
}): UiSnapshot => {
  const {
    accounts,
    approvals,
    chains,
    permissions,
    session,
    keyrings,
    attention,
    namespaceBindings,
    transactions,
    approvalFlowRegistry,
  } = deps;

  const chain = chains.getSelectedChainView();
  const networks = chains.buildWalletNetworksSnapshot();
  const resolvedChain = chain.chainRef;
  const uiBindings = namespaceBindings.getUi(chain.namespace);

  const accountList = session.unlock.isUnlocked()
    ? accounts.listOwnedForNamespace({ namespace: chain.namespace, chainRef: resolvedChain }).map((account) => ({
        accountKey: account.accountKey,
        canonicalAddress: account.canonicalAddress,
        displayAddress: account.displayAddress,
      }))
    : [];
  const activeAccount = session.unlock.isUnlocked()
    ? accounts.getActiveAccountForNamespace({ namespace: chain.namespace, chainRef: resolvedChain })
    : null;

  const accountsState = accounts.getState();
  const totalCount = Object.values(accountsState.namespaces).reduce((sum, ns) => sum + ns.accountKeys.length, 0);

  const approvalState = approvals.getState();
  const approvalSummaries = approvalState.pending
    .map((item) => {
      const record = approvals.get(item.id);
      if (!record) return null;

      try {
        return approvalFlowRegistry.present(record, {
          accounts,
          chainViews: chains,
          transactions,
        });
      } catch {
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const keyringWarnings = keyrings
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
    chainCapabilities: {
      nativeBalance: Boolean(uiBindings?.getNativeBalance),
      sendTransaction:
        Boolean(uiBindings?.createSendTransactionRequest) && namespaceBindings.hasTransaction(chain.namespace),
    },
    networks: {
      ...networks,
    },
    accounts: {
      totalCount,
      list: accountList,
      active: activeAccount
        ? {
            accountKey: activeAccount.accountKey,
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
    permissions: permissions.buildUiPermissionsSnapshot(),
    vault: {
      initialized: session.vault.getStatus().hasEnvelope,
    },
    warnings: {
      hdKeyringsNeedingBackup: keyringWarnings,
    },
  };

  return UiSnapshotSchema.parse(snapshot);
};
