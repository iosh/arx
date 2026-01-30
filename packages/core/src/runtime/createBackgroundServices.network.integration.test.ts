import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionScopes } from "../controllers/index.js";
import type { AccountsSnapshot, NetworkSnapshot, PermissionsSnapshot, TransactionsSnapshot } from "../storage/index.js";
import {
  ACCOUNTS_SNAPSHOT_VERSION,
  NETWORK_SNAPSHOT_VERSION,
  PERMISSIONS_SNAPSHOT_VERSION,
  StorageNamespaces,
  TRANSACTIONS_SNAPSHOT_VERSION,
} from "../storage/index.js";
import {
  buildRpcSnapshot,
  createChainMetadata,
  flushAsync,
  isAccountsSnapshot,
  isNetworkSnapshot,
  setupBackground,
  TEST_MNEMONIC,
} from "./__fixtures__/backgroundTestSetup.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundServices (network integration)", () => {
  it("synchronizes network state, storage, and account pointer when switching to a newly registered chain", async () => {
    const mainChain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const secondaryChain = createChainMetadata({
      chainRef: "eip155:1030",
      chainId: "0x406",
      displayName: "Conflux eSpace",
    });
    const context = await setupBackground({ chainSeed: [mainChain], settingsSeed: null });
    const { services, storagePort } = context;
    try {
      await services.session.vault.initialize({ password: "test" });
      await services.session.unlock.unlock({ password: "test" });

      const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const { account } = await services.accountsRuntime.deriveAccount({
        namespace: mainChain.namespace,
        chainRef: mainChain.chainRef,
        keyringId,
        makePrimary: true,
        switchActive: true,
      });
      const accountAddress = account.address;

      const pointerBefore = services.controllers.accounts.getActivePointer();
      expect(pointerBefore).toEqual({
        namespace: mainChain.namespace,
        chainRef: mainChain.chainRef,
        address: accountAddress,
      });

      const pointerSwitched = new Promise<void>((resolve) => {
        const unsubscribe = services.controllers.accounts.onActiveChanged((pointer) => {
          if (pointer?.chainRef === secondaryChain.chainRef) {
            unsubscribe();
            resolve();
          }
        });
      });

      await services.controllers.chainRegistry.upsertChain(secondaryChain);
      await services.controllers.network.switchChain(secondaryChain.chainRef);
      await pointerSwitched;
      await flushAsync();

      const pointerAfter = services.controllers.accounts.getActivePointer();
      expect(pointerAfter).toEqual({
        namespace: secondaryChain.namespace,
        chainRef: secondaryChain.chainRef,
        address: accountAddress,
      });

      const networkState = services.controllers.network.getState();
      expect(networkState.activeChain).toBe(secondaryChain.chainRef);
      expect(networkState.knownChains.map((chain) => chain.chainRef)).toEqual(
        expect.arrayContaining([mainChain.chainRef, secondaryChain.chainRef]),
      );

      const accountsSnapshots = storagePort.savedSnapshots.filter(isAccountsSnapshot);
      expect(accountsSnapshots.length).toBeGreaterThan(0);
      expect(accountsSnapshots.at(-1)?.envelope.payload.active?.chainRef).toBe(secondaryChain.chainRef);

      const networkSnapshots = storagePort.savedSnapshots.filter(isNetworkSnapshot);
      expect(networkSnapshots.length).toBeGreaterThan(0);

      const payload = networkSnapshots.at(-1)?.envelope.payload;
      expect(payload?.rpc[secondaryChain.chainRef]).toBeDefined();
      expect((payload as any)?.activeChain).toBeUndefined();
      expect((payload as any)?.knownChains).toBeUndefined();

      expect((await context.settingsPort!.get())?.activeChainRef).toBe(secondaryChain.chainRef);
    } finally {
      context.destroy();
    }
  });

  it("hydrates controller state from storage snapshots and realigns network state on cold start", async () => {
    const mainChain = createChainMetadata();
    const altChain = createChainMetadata({
      chainRef: "eip155:10",
      chainId: "0xa",
      displayName: "Optimism",
    });
    const orphanChain = createChainMetadata({
      chainRef: "eip155:31337",
      chainId: "0x7a69",
      displayName: "Dev Chain",
    });
    const accountAddress = "0x1234567890abcdef1234567890abcdef12345678";

    const networkSnapshot: NetworkSnapshot = {
      version: NETWORK_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        rpc: {
          [orphanChain.chainRef]: buildRpcSnapshot(orphanChain),
        },
      },
    };

    const accountsSnapshot: AccountsSnapshot = {
      version: ACCOUNTS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        namespaces: {
          [mainChain.namespace]: { all: [accountAddress], primary: accountAddress },
        },
        active: {
          namespace: mainChain.namespace,
          chainRef: mainChain.chainRef,
          address: accountAddress,
        },
      },
    };

    const permissionsSnapshot: PermissionsSnapshot = {
      version: PERMISSIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        origins: {
          "https://dapp.example": {
            [mainChain.namespace]: {
              scopes: [PermissionScopes.Basic, PermissionScopes.Accounts],
              chains: [mainChain.chainRef],
            },
          },
        },
      },
    };

    const transactionsSnapshot: TransactionsSnapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [],
        history: [
          {
            id: "tx-storage-1",
            namespace: mainChain.namespace,
            chainRef: orphanChain.chainRef,
            origin: "https://dapp.example",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            request: {
              namespace: mainChain.namespace,
              chainRef: orphanChain.chainRef,
              payload: {
                from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                value: "0x0",
                data: "0x",
              },
            },
            status: "approved",
            hash: null,
            receipt: null,
            error: null,
            userRejected: false,
            warnings: [],
            issues: [],
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
      },
    };

    const context = await setupBackground({
      chainSeed: [mainChain, altChain],
      settingsSeed: { id: "settings", activeChainRef: orphanChain.chainRef, updatedAt: 1_000 },
      storageSeed: {
        [StorageNamespaces.Network]: networkSnapshot,
        [StorageNamespaces.Accounts]: accountsSnapshot,
        [StorageNamespaces.Permissions]: permissionsSnapshot,
        [StorageNamespaces.Transactions]: transactionsSnapshot,
      },
      now: () => 42_000,
    });
    await flushAsync();

    try {
      expect((await context.settingsPort!.get())?.activeChainRef).toBe(mainChain.chainRef);

      expect(context.services.controllers.accounts.getState()).toEqual(accountsSnapshot.payload);
      expect(context.services.controllers.permissions.getState()).toEqual(permissionsSnapshot.payload);
      expect(context.services.controllers.approvals.getState().pending).toHaveLength(0);

      await context.services.controllers.transactions.processTransaction("tx-storage-1");

      const meta = context.services.controllers.transactions.getMeta("tx-storage-1");
      expect(meta?.status).toBe("failed");
      expect(meta?.error?.message).toContain("not unlocked");

      const transactionsState = context.services.controllers.transactions.getState();
      expect(transactionsState.pending).toHaveLength(0);
      expect(transactionsState.history).toHaveLength(1);
      expect(transactionsState.history[0]?.id).toBe("tx-storage-1");
      expect(transactionsState.history[0]?.status).toBe("failed");
      expect(transactionsState.history[0]?.error?.message).toContain("not unlocked");

      const networkState = context.services.controllers.network.getState();
      expect(networkState.activeChain).toBe(mainChain.chainRef);
      expect(networkState.knownChains.map((chain) => chain.chainRef)).toEqual(
        expect.arrayContaining([mainChain.chainRef, altChain.chainRef]),
      );
      expect(Object.keys(networkState.rpc)).toEqual(expect.arrayContaining([mainChain.chainRef, altChain.chainRef]));
      expect(networkState.rpc[orphanChain.chainRef]).toBeUndefined();
    } finally {
      context.destroy();
    }
  });
});
