import { type UiSnapshot, UiSnapshotSchema } from "../protocol/schemas.js";
import type {
  UiAccountsAccess,
  UiAttentionAccess,
  UiChainsAccess,
  UiKeyringsAccess,
  UiNamespaceBindingsAccess,
  UiPermissionsAccess,
  UiSessionAccess,
} from "./types.js";

export const buildUiSnapshot = (deps: {
  accounts: UiAccountsAccess;
  chains: Pick<
    UiChainsAccess,
    "buildWalletNetworksSnapshot" | "findAvailableChainView" | "getApprovalReviewChainView" | "getSelectedChainView"
  >;
  permissions: Pick<UiPermissionsAccess, "buildUiPermissionsSnapshot">;
  session: UiSessionAccess;
  keyrings: Pick<UiKeyringsAccess, "getKeyrings">;
  attention: Pick<UiAttentionAccess, "getSnapshot">;
  namespaceBindings: UiNamespaceBindingsAccess;
}): UiSnapshot => {
  const { accounts, chains, permissions, session, keyrings, attention, namespaceBindings } = deps;

  const chain = chains.getSelectedChainView();
  const networks = chains.buildWalletNetworksSnapshot();
  const resolvedChain = chain.chainRef;
  const uiBindings = namespaceBindings.getUi(chain.namespace);
  const sessionStatus = session.getStatus();
  const unlocked = sessionStatus.isUnlocked;

  const accountList = unlocked
    ? accounts.listOwnedForNamespace({ namespace: chain.namespace, chainRef: resolvedChain }).map((account) => ({
        accountKey: account.accountKey,
        canonicalAddress: account.canonicalAddress,
        displayAddress: account.displayAddress,
      }))
    : [];
  const activeAccount = unlocked
    ? accounts.getActiveAccountForNamespace({ namespace: chain.namespace, chainRef: resolvedChain })
    : null;

  const accountsState = accounts.getState();
  const totalCount = Object.values(accountsState.namespaces).reduce((sum, ns) => sum + ns.accountKeys.length, 0);

  const pendingHdKeyrings = keyrings
    .getKeyrings()
    .filter((meta) => meta.type === "hd" && meta.needsBackup === true)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  const nextHdKeyring = pendingHdKeyrings[0] ?? null;

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
        Boolean(uiBindings?.createSendTransactionRequest) &&
        namespaceBindings.hasTransaction(chain.namespace) &&
        namespaceBindings.hasTransactionReceiptTracking(chain.namespace),
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
      isUnlocked: unlocked,
      autoLockDurationMs: sessionStatus.autoLockDurationMs,
      nextAutoLockAt: sessionStatus.nextAutoLockAt,
    },
    attention: attention.getSnapshot(),
    permissions: permissions.buildUiPermissionsSnapshot(),
    backup: {
      pendingHdKeyringCount: pendingHdKeyrings.length,
      nextHdKeyring: nextHdKeyring
        ? {
            keyringId: nextHdKeyring.id,
            alias: nextHdKeyring.alias ?? null,
          }
        : null,
    },
    vault: {
      initialized: sessionStatus.vaultInitialized,
    },
  };

  return UiSnapshotSchema.parse(snapshot);
};
