import { describe, expect, it } from "vitest";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiAccountsAccess, UiSessionAccess } from "./types.js";

const selectedChain = {
  chainRef: "eip155:1",
  chainId: "0x1",
  namespace: "eip155",
  displayName: "Ethereum",
  shortName: "eth",
  icon: null,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const networks = {
  selectedNamespace: selectedChain.namespace,
  active: selectedChain.chainRef,
  known: [selectedChain],
  available: [selectedChain],
};

const createDeps = () => ({
  accounts: {
    getState: () => ({ namespaces: {} }),
    listOwnedForNamespace: () => [],
    getActiveAccountForNamespace: () => null,
    setActiveAccount: async () => {
      throw new Error("not needed in snapshot test");
    },
    onStateChanged: () => () => {},
  } satisfies UiAccountsAccess,
  chains: {
    buildWalletNetworksSnapshot: () => networks,
    findAvailableChainView: () => selectedChain,
    getApprovalReviewChainView: ({ record }: { record: { namespace: string; chainRef: string } }) => ({
      ...selectedChain,
      namespace: record.namespace,
      chainRef: record.chainRef,
    }),
    getSelectedChainView: () => selectedChain,
  },
  permissions: {
    buildUiPermissionsSnapshot: () => ({ origins: {} }),
  },
  session: {
    getStatus: () => ({
      phase: "uninitialized" as const,
      vaultInitialized: false,
      isUnlocked: false,
      autoLockDurationMs: 900_000,
      nextAutoLockAt: null,
    }),
    getUnlockState: () => ({
      isUnlocked: false,
      lastUnlockedAt: null,
      timeoutMs: 900_000,
      nextAutoLockAt: null,
    }),
    isUnlocked: () => false,
    hasInitializedVault: () => false,
    unlock: async () => ({
      isUnlocked: true,
      lastUnlockedAt: 0,
      timeoutMs: 900_000,
      nextAutoLockAt: null,
    }),
    lock: () => ({
      isUnlocked: false,
      lastUnlockedAt: null,
      timeoutMs: 900_000,
      nextAutoLockAt: null,
    }),
    resetAutoLockTimer: () => ({
      isUnlocked: false,
      lastUnlockedAt: null,
      timeoutMs: 900_000,
      nextAutoLockAt: null,
    }),
    setAutoLockDuration: () => ({ autoLockDurationMs: 900_000, nextAutoLockAt: null }),
    onStateChanged: () => () => {},
  } satisfies UiSessionAccess,
  keyrings: {
    getKeyrings: () => [],
  },
  attention: {
    getSnapshot: () => ({ queue: [], count: 0 }),
  },
  namespaceBindings: {
    getUi: () => undefined,
    hasTransaction: () => false,
    hasTransactionReceiptTracking: () => false,
  },
  transactions: {
    getMeta: () => undefined,
  },
});

describe("buildUiSnapshot", () => {
  it("derives session and vault facts from the session status", () => {
    const deps = createDeps();
    deps.session.getStatus = () => ({
      phase: "locked",
      vaultInitialized: true,
      isUnlocked: false,
      autoLockDurationMs: 123_000,
      nextAutoLockAt: 456_000,
    });
    deps.session.getUnlockState = () => ({
      isUnlocked: true,
      lastUnlockedAt: 999,
      timeoutMs: 900_000,
      nextAutoLockAt: 999_999,
    });
    deps.session.hasInitializedVault = () => false;

    const snapshot = buildUiSnapshot(deps);

    expect(snapshot.session).toEqual({
      isUnlocked: false,
      autoLockDurationMs: 123_000,
      nextAutoLockAt: 456_000,
    });
    expect(snapshot.vault).toEqual({
      initialized: true,
    });
    expect(snapshot.backup).toEqual({
      pendingHdKeyringCount: 0,
      nextHdKeyring: null,
    });
    expect(snapshot.accounts.list).toEqual([]);
    expect(snapshot.accounts.active).toBeNull();
  });

  it("summarizes pending HD backups as a single stable shell status", () => {
    const deps = createDeps();
    deps.keyrings.getKeyrings = () => [
      {
        id: "00000000-0000-4000-8000-000000000002",
        type: "hd",
        createdAt: 200,
        alias: "Later wallet",
        needsBackup: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "hd",
        createdAt: 100,
        alias: "Primary wallet",
        needsBackup: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        type: "hd",
        createdAt: 300,
        alias: "Backed up wallet",
        needsBackup: false,
      },
    ];

    const snapshot = buildUiSnapshot(deps);

    expect(snapshot.backup).toEqual({
      pendingHdKeyringCount: 2,
      nextHdKeyring: {
        keyringId: "00000000-0000-4000-8000-000000000001",
        alias: "Primary wallet",
      },
    });
  });
});
