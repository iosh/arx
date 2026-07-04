import { afterEach, describe, expect, it, vi } from "vitest";
import { accountIdFromChainAddress } from "../accounts/addressing/accountId.js";
import { ApprovalKinds } from "../approvals/queue/types.js";
import { eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
import {
  flushAsync,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryKeyringMetasPort,
  MemoryPermissionsPort,
  MemoryProviderChainSelectionPort,
  MemoryTransactionAggregatesPort,
  MemoryVaultMetaPort,
  MemoryWalletChainSelectionPort,
  TEST_ACCOUNT_CODECS,
  TEST_MNEMONIC,
} from "../runtime/__fixtures__/backgroundTestSetup.js";
import { createArxWallet, createArxWalletRuntime } from "./createArxWallet.js";
import type { CreateArxWalletInput } from "./types.js";

const PASSWORD = "secret-pass";
const ORIGIN = "https://dapp.example";
const EIP155_NAMESPACE = "eip155";
const EIP155_CHAIN_REF = "eip155:1" as const;
const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const ACCOUNT_ID = accountIdFromChainAddress({
  chainRef: EIP155_CHAIN_REF,
  address: ACCOUNT_ADDRESS,
  accountAddressing: TEST_ACCOUNT_CODECS,
});
const KEYRING_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_PORT_ID = "provider-port";
const PROVIDER_SESSION_ID = "11111111-1111-4111-8111-111111111111";

const createWalletInput = (params?: {
  manifests?: readonly NamespaceManifest[];
  walletChainSelectionPort?: MemoryWalletChainSelectionPort;
  chainDefinitionsPort?: MemoryChainDefinitionsPort;
  chainRpcDefaultEndpointsPort?: MemoryChainRpcDefaultEndpointsPort;
  chainRpcEndpointOverridesPort?: MemoryChainRpcEndpointOverridesPort;
  providerChainSelectionPort?: MemoryProviderChainSelectionPort;
  accountsPort?: MemoryAccountsPort;
  permissionsPort?: MemoryPermissionsPort;
  keyringMetasPort?: MemoryKeyringMetasPort;
  transactionAggregatesPort?: MemoryTransactionAggregatesPort;
}): CreateArxWalletInput => {
  const manifests = params?.manifests ?? [eip155NamespaceManifest];

  return {
    namespaces: {
      manifests,
    },
    storage: {
      ports: {
        vault: new MemoryVaultMetaPort(),
        keyrings: params?.keyringMetasPort ?? new MemoryKeyringMetasPort(),
        accounts: params?.accountsPort ?? new MemoryAccountsPort(),
        permissions: params?.permissionsPort ?? new MemoryPermissionsPort(),
        chains: {
          chainDefinitions: params?.chainDefinitionsPort ?? new MemoryChainDefinitionsPort(),
          chainRpcDefaultEndpoints: params?.chainRpcDefaultEndpointsPort ?? new MemoryChainRpcDefaultEndpointsPort(),
          chainRpcEndpointOverrides: params?.chainRpcEndpointOverridesPort ?? new MemoryChainRpcEndpointOverridesPort(),
          walletChainSelection: params?.walletChainSelectionPort ?? new MemoryWalletChainSelectionPort(),
          providerChainSelection: params?.providerChainSelectionPort ?? new MemoryProviderChainSelectionPort(),
        },
        transactions: params?.transactionAggregatesPort ?? new MemoryTransactionAggregatesPort(),
      },
    },
  };
};

const createSeededAccountsPort = () =>
  new MemoryAccountsPort([
    {
      accountId: ACCOUNT_ID,
      keyringId: KEYRING_ID,
      createdAt: 1,
    },
  ]);

const createSeededPermissionsPort = (origins: readonly string[] = [ORIGIN]) =>
  new MemoryPermissionsPort(
    origins.map((origin) => ({
      origin,
      namespace: EIP155_NAMESPACE,
      chainScopes: {
        [EIP155_CHAIN_REF]: [ACCOUNT_ID],
      },
    })),
  );

const createWalletRuntime = async (params?: Parameters<typeof createWalletInput>[0]) => {
  return await createArxWalletRuntime(createWalletInput(params));
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createArxWallet", () => {
  it("boots an eip155 wallet and repairs invalid persisted network state", async () => {
    const walletChainSelectionPort = new MemoryWalletChainSelectionPort({
      id: "wallet-chain-selection",
      selectedNamespace: "solana",
      chainRefByNamespace: { solana: "solana:1" },
      updatedAt: 1,
    });
    const runtime = await createWalletRuntime({ walletChainSelectionPort });

    try {
      const { wallet } = runtime;
      await flushAsync();
      const eip155Manifest = wallet.namespaces.requireManifest("eip155");

      expect(wallet.namespaces.listNamespaces()).toEqual(["eip155"]);
      expect(eip155Manifest.namespace).toBe("eip155");
      expect(eip155Manifest.core.chainSeeds?.length).toBeGreaterThan(0);
      expect(eip155Manifest.runtime.createSigner).toBeTypeOf("function");
      expect(wallet.session.getStatus().status).toBe("uninitialized");
      expect(wallet.accounts.getWalletSetupState()).toEqual({
        totalAccountCount: 0,
        hasOwnedAccounts: false,
      });
      expect(wallet.approvals.getState()).toEqual({ pending: [] });
      expect(wallet.networks.getSelectedNamespace()).toBe("eip155");
      expect(wallet.attention.getSnapshot()).toEqual({ queue: [], count: 0 });
      expect(wallet.dappConnections.getState()).toEqual({ connections: [], count: 0 });
      expect(wallet.networks.getSelectedChainView()).toMatchObject({
        namespace: "eip155",
        chainRef: "eip155:1",
      });

      const correctedSelection = walletChainSelectionPort.saved.at(-1);
      expect(correctedSelection).toEqual({
        id: "wallet-chain-selection",
        selectedNamespace: "eip155",
        chainRefByNamespace: {
          eip155: "eip155:1",
        },
        updatedAt: expect.any(Number),
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("exposes accounts owner methods for keyring mutations and backup/setup projections", async () => {
    const runtime = await createWalletRuntime();

    try {
      const { wallet } = runtime;
      await wallet.session.createVault({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      const created = await wallet.accounts.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC, alias: "Primary wallet" });
      const derived = await wallet.accounts.deriveAccount(created.keyringId);

      expect(wallet.accounts.getWalletSetupState()).toEqual({
        totalAccountCount: 2,
        hasOwnedAccounts: true,
      });
      expect(wallet.accounts.getBackupStatus()).toEqual({
        pendingHdKeyringCount: 1,
        nextHdKeyring: {
          keyringId: created.keyringId,
          alias: "Primary wallet",
        },
      });
      expect(wallet.accounts.getKeyrings()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.keyringId,
            type: "hd",
            alias: "Primary wallet",
            needsBackup: true,
          }),
        ]),
      );
      expect(wallet.accounts.getAccountsByKeyring(created.keyringId).map((account) => account.accountId)).toHaveLength(
        2,
      );

      await wallet.accounts.markBackedUp(created.keyringId);
      expect(wallet.accounts.getBackupStatus()).toEqual({
        pendingHdKeyringCount: 0,
        nextHdKeyring: null,
      });

      const ownedAccounts = wallet.accounts.listOwnedForNamespace({
        namespace: EIP155_NAMESPACE,
        chainRef: EIP155_CHAIN_REF,
      });
      expect(ownedAccounts.map((account) => account.displayAddress.toLowerCase())).toEqual(
        expect.arrayContaining([created.address.toLowerCase(), derived.address.toLowerCase()]),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("keeps approvals pending while locked and resolves them through the approvals owner after unlock", async () => {
    const runtime = await createWalletRuntime();

    try {
      const { wallet } = runtime;
      await wallet.session.createVault({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      const { address } = await wallet.accounts.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
      wallet.session.lock("manual");

      const approvalId = "approval-sign-message";
      const handle = wallet.approvals.create(
        {
          approvalId,
          kind: ApprovalKinds.SignMessage,
          origin: ORIGIN,
          namespace: EIP155_NAMESPACE,
          chainRef: EIP155_CHAIN_REF,
          createdAt: 1_000,
          request: {
            chainRef: EIP155_CHAIN_REF,
            from: address,
            message: "0x68656c6c6f",
          },
        },
        {
          origin: ORIGIN,
          source: "provider",
          requestId: "request-1",
        },
      );

      expect(wallet.approvals.getState()).toEqual({
        pending: [
          expect.objectContaining({
            approvalId,
            kind: ApprovalKinds.SignMessage,
          }),
        ],
      });
      await wallet.session.unlock({ password: PASSWORD });
      await expect(wallet.approvals.resolve({ approvalId, action: "approve" })).resolves.toMatchObject({
        approvalId,
        status: "approved",
        terminalReason: "user_approve",
        value: expect.stringMatching(/^0x[0-9a-f]+$/i),
      });
      await expect(handle.settled).resolves.toMatch(/^0x[0-9a-f]+$/i);
      expect(wallet.approvals.getState()).toEqual({ pending: [] });
    } finally {
      await runtime.shutdown();
    }
  });

  it("dismisses pending approvals through the wallet API with user-dismissed semantics", async () => {
    const runtime = await createWalletRuntime();

    try {
      const { walletApi, wallet } = runtime;
      await wallet.session.createVault({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      const { address } = await wallet.accounts.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
      const approvalId = "approval-dismiss-sign-message";
      const handle = wallet.approvals.create(
        {
          approvalId,
          kind: ApprovalKinds.SignMessage,
          origin: ORIGIN,
          namespace: EIP155_NAMESPACE,
          chainRef: EIP155_CHAIN_REF,
          createdAt: 2_000,
          request: {
            chainRef: EIP155_CHAIN_REF,
            from: address,
            message: "0x68656c6c6f",
          },
        },
        {
          origin: ORIGIN,
          source: "provider",
          requestId: "request-dismiss-1",
        },
      );

      await expect(walletApi.approvals.dismiss({ approvalId })).resolves.toBeNull();
      await expect(handle.settled).rejects.toMatchObject({
        code: "approval.user_dismissed",
      });
      expect(wallet.approvals.getState()).toEqual({ pending: [] });
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects empty namespace manifests", async () => {
    await expect(createArxWallet(createWalletInput({ manifests: [] }))).rejects.toThrow(
      /requires at least one namespace manifest/,
    );
  });

  it("rejects duplicate namespace manifests", async () => {
    await expect(
      createArxWallet(createWalletInput({ manifests: [eip155NamespaceManifest, eip155NamespaceManifest] })),
    ).rejects.toThrow(/Duplicate wallet namespace manifest "eip155"/);
  });

  it("keeps permissions and dappConnections separated while active provider scopes stay connected", async () => {
    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
      permissionsPort: createSeededPermissionsPort(),
    });

    try {
      const { wallet } = runtime;
      const provider = wallet.createProvider();
      const permissionSnapshot = runtime.services.permissionViews.getAuthorizationSnapshot(ORIGIN, {
        chainRef: EIP155_CHAIN_REF,
      });
      expect(permissionSnapshot.isAuthorized).toBe(true);
      expect(permissionSnapshot.accounts).toHaveLength(1);
      expect(wallet.dappConnections.getState()).toEqual({ connections: [], count: 0 });
      await expect(
        provider.activateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE }),
      ).resolves.toMatchObject({
        snapshot: {
          namespace: EIP155_NAMESPACE,
          chain: {
            chainId: "0x1",
            chainRef: EIP155_CHAIN_REF,
          },
          isUnlocked: false,
        },
        accounts: [],
      });
      expect(wallet.dappConnections.getState().count).toBe(1);
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: true,
          accounts: [],
        },
      );

      await wallet.session.createVault({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      await expect(
        provider.activateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE }),
      ).resolves.toMatchObject({
        accounts: [expect.any(String)],
        snapshot: {
          chain: { chainRef: EIP155_CHAIN_REF },
        },
      });
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: true,
        },
      );
      expect(wallet.dappConnections.getState().count).toBe(1);

      await wallet.permissions.revokeOriginPermissions(ORIGIN);
      await flushAsync();
      expect(wallet.dappConnections.getState().count).toBe(1);
      expect(
        runtime.services.permissionViews.getAuthorizationSnapshot(ORIGIN, { chainRef: EIP155_CHAIN_REF }).isAuthorized,
      ).toBe(false);
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: true,
          accounts: [],
        },
      );

      await wallet.permissions.grantAuthorization(ORIGIN, {
        namespace: EIP155_NAMESPACE,
        chains: [{ chainRef: EIP155_CHAIN_REF, accountIds: [ACCOUNT_ID] }],
      });
      await flushAsync();
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: true,
          accounts: [expect.any(String)],
        },
      );
      expect(wallet.dappConnections.getState().count).toBe(1);

      wallet.session.lock("manual");
      await flushAsync();
      expect(wallet.dappConnections.getState().count).toBe(1);
      expect(
        runtime.services.permissionViews.getAuthorizationSnapshot(ORIGIN, { chainRef: EIP155_CHAIN_REF }).isAuthorized,
      ).toBe(true);
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: true,
          accounts: [],
        },
      );

      provider.deactivateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
      expect(wallet.dappConnections.getState().count).toBe(0);
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: false,
        },
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("creates provider contracts with active connection scope state", async () => {
    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
      permissionsPort: createSeededPermissionsPort(),
    });

    try {
      const { wallet } = runtime;
      const provider = wallet.createProvider();

      expect(wallet.dappConnections.getState()).toEqual({ connections: [], count: 0 });

      await wallet.session.createVault({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      const activated = await provider.activateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
      expect(activated.accounts).toHaveLength(1);
      expect(activated.snapshot.chain.chainRef).toBe(EIP155_CHAIN_REF);
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: true,
        },
      );

      provider.deactivateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
      await expect(provider.getConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).resolves.toMatchObject(
        {
          connected: false,
        },
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("exposes focused wallet owner projections for session, network, account, and attention state", async () => {
    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
    });

    try {
      const { wallet } = runtime;
      wallet.attention.requestAttention({
        reason: "unlock_required",
        origin: ORIGIN,
        method: "eth_requestAccounts",
        namespace: EIP155_NAMESPACE,
        chainRef: EIP155_CHAIN_REF,
      });

      expect(wallet.session.getStatus()).toMatchObject({ vaultInitialized: false, isUnlocked: false });
      expect(wallet.attention.getSnapshot()).toMatchObject({ count: 1 });
      expect(wallet.accounts.getWalletSetupState()).toEqual({
        totalAccountCount: 1,
        hasOwnedAccounts: true,
      });
      expect(
        wallet.accounts.getActiveAccountForNamespace({
          namespace: EIP155_NAMESPACE,
          chainRef: EIP155_CHAIN_REF,
        }),
      ).toMatchObject({ accountId: ACCOUNT_ID });
      expect(wallet.networks.getSelectedNamespace()).toBe(EIP155_NAMESPACE);
      expect(wallet.networks.getSelectedChainView().chainRef).toBe(EIP155_CHAIN_REF);

      await wallet.session.createVault({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      expect(wallet.session.getStatus()).toMatchObject({ vaultInitialized: true, isUnlocked: true });
      expect(wallet.attention.getSnapshot()).toMatchObject({ count: 1 });
      expect(wallet.accounts.getWalletSetupState()).toEqual({
        totalAccountCount: 1,
        hasOwnedAccounts: true,
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("does not persist dappConnections across restart", async () => {
    const accountsPort = createSeededAccountsPort();
    const permissionsPort = createSeededPermissionsPort();
    const runtime = await createWalletRuntime({
      accountsPort,
      permissionsPort,
    });

    try {
      const { wallet } = runtime;
      const provider = wallet.createProvider();
      await wallet.session.createVault({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });
      await provider.activateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
      expect(wallet.dappConnections.getState().count).toBe(1);
    } finally {
      await runtime.shutdown();
    }

    const reopened = await createWalletRuntime({
      accountsPort,
      permissionsPort,
    });

    try {
      expect(reopened.wallet.dappConnections.getState()).toEqual({ connections: [], count: 0 });
      expect(
        reopened.services.permissionViews.getAuthorizationSnapshot(ORIGIN, { chainRef: EIP155_CHAIN_REF }).isAuthorized,
      ).toBe(true);
    } finally {
      await reopened.shutdown();
    }
  });

  it("exposes engine-owned provider and wallet API contracts", async () => {
    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
      permissionsPort: createSeededPermissionsPort(),
    });

    try {
      const { wallet, walletApi } = runtime;
      const provider = wallet.createProvider();

      await wallet.session.createVault({ password: PASSWORD });
      await expect(walletApi.session.getStatus()).resolves.toMatchObject({
        vaultInitialized: true,
        isUnlocked: false,
      });
      await expect(walletApi.session.unlock({ password: PASSWORD })).resolves.toMatchObject({
        status: "unlocked",
      });
      await provider.activateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
      wallet.session.lock("manual");

      await expect(walletApi.session.getStatus()).resolves.toMatchObject({ isUnlocked: false });
      await expect(walletApi.accounts.listCurrentChain()).resolves.toMatchObject({
        totalCount: 1,
        active: {
          accountId: ACCOUNT_ID,
        },
        list: [expect.objectContaining({ accountId: ACCOUNT_ID })],
      });
      await expect(
        provider.request({
          scope: {
            transport: "provider",
            origin: ORIGIN,
            portId: PROVIDER_PORT_ID,
            sessionId: PROVIDER_SESSION_ID,
          },
          namespace: EIP155_NAMESPACE,
          request: {
            id: "rpc-accounts-locked",
            jsonrpc: "2.0",
            method: "eth_accounts",
          },
        }),
      ).resolves.toMatchObject({
        id: "rpc-accounts-locked",
        jsonrpc: "2.0",
        result: [],
      });
    } finally {
      await runtime.shutdown();
    }
  });
});
