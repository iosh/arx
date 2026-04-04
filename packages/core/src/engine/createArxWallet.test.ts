import { ArxReasons, arxError } from "@arx/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import { ApprovalKinds } from "../controllers/approval/types.js";
import {
  flushAsync,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
  TEST_ACCOUNT_CODECS,
  TEST_MNEMONIC,
  TEST_RECEIPT_POLL_INTERVAL,
  toRegistryEntity,
} from "../runtime/__fixtures__/backgroundTestSetup.js";
import type { TransactionRecord } from "../storage/records.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";
import { createArxWallet, createArxWalletRuntime } from "./createArxWallet.js";
import { createEip155WalletNamespaceModule } from "./modules/eip155.js";
import type { CreateArxWalletInput, WalletNamespaceModule } from "./types.js";

const PASSWORD = "secret-pass";
const ORIGIN = "https://dapp.example";
const EIP155_NAMESPACE = "eip155";
const EIP155_CHAIN_REF = "eip155:1" as const;
const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const ACCOUNT_KEY = toAccountKeyFromAddress({
  chainRef: EIP155_CHAIN_REF,
  address: ACCOUNT_ADDRESS,
  accountCodecs: TEST_ACCOUNT_CODECS,
});
const KEYRING_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_PORT_ID = "provider-port";
const PROVIDER_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_REQUEST_ID = "provider-request";

const createWalletInput = (params?: {
  modules?: readonly WalletNamespaceModule[];
  networkPreferencesPort?: MemoryNetworkPreferencesPort;
  accountsPort?: MemoryAccountsPort;
  permissionsPort?: MemoryPermissionsPort;
  settingsPort?: MemorySettingsPort;
  keyringMetasPort?: MemoryKeyringMetasPort;
  transactionsPort?: MemoryTransactionsPort;
}): CreateArxWalletInput => {
  const modules = params?.modules ?? [createEip155WalletNamespaceModule()];
  const chainSeeds = modules.flatMap((module) => module.engine.facts.chainSeeds ?? []);

  return {
    namespaces: {
      modules,
    },
    storage: {
      ports: {
        accounts: params?.accountsPort ?? new MemoryAccountsPort(),
        chainDefinitions: new MemoryChainDefinitionsPort(
          chainSeeds.map((chain, index) => toRegistryEntity(chain, index)),
        ),
        keyringMetas: params?.keyringMetasPort ?? new MemoryKeyringMetasPort(),
        networkPreferences: params?.networkPreferencesPort ?? new MemoryNetworkPreferencesPort(),
        permissions: params?.permissionsPort ?? new MemoryPermissionsPort(),
        settings: params?.settingsPort ?? new MemorySettingsPort({ id: "settings", updatedAt: 0 }),
        transactions: params?.transactionsPort ?? new MemoryTransactionsPort(),
      },
    },
  };
};

const createSeededAccountsPort = () =>
  new MemoryAccountsPort([
    {
      accountKey: ACCOUNT_KEY,
      namespace: EIP155_NAMESPACE,
      keyringId: KEYRING_ID,
      createdAt: 1,
    },
  ]);

const createSeededPermissionsPort = (origins: readonly string[] = [ORIGIN]) =>
  new MemoryPermissionsPort(
    origins.map((origin) => ({
      origin,
      namespace: EIP155_NAMESPACE,
      chains: [
        {
          chainRef: EIP155_CHAIN_REF,
          accountKeys: [ACCOUNT_KEY],
        },
      ],
      updatedAt: 1,
    })),
  );

const createWalletRuntime = async (params?: Parameters<typeof createWalletInput>[0]) => {
  return await createArxWalletRuntime(createWalletInput(params));
};

const createProviderRpcContext = (requestId: string = PROVIDER_REQUEST_ID) => ({
  chainRef: EIP155_CHAIN_REF,
  providerNamespace: EIP155_NAMESPACE,
  requestContext: {
    transport: "provider" as const,
    portId: PROVIDER_PORT_ID,
    sessionId: PROVIDER_SESSION_ID,
    requestId,
    origin: ORIGIN,
  },
});

const createWalletModuleWithTransactionAdapter = (adapter: TransactionAdapter): WalletNamespaceModule => {
  const module = createEip155WalletNamespaceModule();
  return {
    ...module,
    engine: {
      ...module.engine,
      factories: {
        ...module.engine.factories,
        createTransactionAdapter: () => adapter,
      },
    },
  };
};

const createTransactionRecord = (
  overrides: Partial<TransactionRecord> & Pick<TransactionRecord, "id" | "status">,
): TransactionRecord => ({
  id: overrides.id,
  namespace: EIP155_NAMESPACE,
  chainRef: EIP155_CHAIN_REF,
  origin: ORIGIN,
  fromAccountKey: ACCOUNT_KEY,
  status: overrides.status,
  request: {
    namespace: EIP155_NAMESPACE,
    chainRef: EIP155_CHAIN_REF,
    payload: {
      chainId: "0x1",
      from: ACCOUNT_ADDRESS,
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x0",
      data: "0x",
    },
  },
  prepared: null,
  hash: null,
  receipt: undefined,
  error: undefined,
  userRejected: false,
  warnings: [],
  issues: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createArxWallet", () => {
  it("boots an eip155 wallet, exposes 20b/20c wallet surfaces, and corrects invalid persisted preferences", async () => {
    const networkPreferencesPort = new MemoryNetworkPreferencesPort({
      id: "network-preferences",
      selectedNamespace: "solana",
      activeChainByNamespace: { solana: "solana:1" },
      rpc: {
        "solana:1": {
          activeIndex: 0,
          strategy: { id: "sticky" },
        },
      },
      updatedAt: 1,
    });

    const runtime = await createWalletRuntime({ networkPreferencesPort });

    try {
      const { wallet } = runtime;
      await flushAsync();
      const eip155Module = wallet.namespaces.requireModule("eip155");

      expect(wallet.namespaces.listNamespaces()).toEqual(["eip155"]);
      expect(eip155Module.namespace).toBe("eip155");
      expect(eip155Module.engine.facts.chainSeeds?.length).toBeGreaterThan(0);
      expect(eip155Module.engine.factories?.createSigner).toBeTypeOf("function");
      expect(wallet.session.getStatus().phase).toBe("uninitialized");
      expect(wallet.accounts.getWalletSetupState()).toEqual({
        totalAccountCount: 0,
        hasOwnedAccounts: false,
      });
      expect(wallet.approvals.getState()).toEqual({ pending: [] });
      expect(wallet.networks.getSelectedNamespace()).toBe("eip155");
      expect(wallet.attention.getSnapshot()).toEqual({ queue: [], count: 0 });
      expect(wallet.dappConnections.getState()).toEqual({ connections: [], count: 0 });
      expect(wallet.snapshots.buildProviderSnapshot("eip155")).toMatchObject({
        namespace: "eip155",
        chain: { chainRef: "eip155:1" },
        isUnlocked: false,
      });
      expect(wallet.snapshots.buildUiSnapshot()).toMatchObject({
        vault: { initialized: false },
        session: { isUnlocked: false },
        networks: { selectedNamespace: "eip155" },
      });

      const correctedPreferences = networkPreferencesPort.saved.at(-1);
      expect(correctedPreferences).toMatchObject({
        selectedNamespace: "eip155",
      });
      expect(correctedPreferences?.activeChainByNamespace.eip155).toBeDefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it("exposes accounts owner methods for keyring mutations and backup/setup projections", async () => {
    const runtime = await createWalletRuntime();

    try {
      const { wallet } = runtime;
      await wallet.session.initialize({ password: PASSWORD });
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
      expect(wallet.accounts.getAccountsByKeyring(created.keyringId).map((account) => account.accountKey)).toHaveLength(
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
      await wallet.session.initialize({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      const { address } = await wallet.accounts.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
      wallet.session.lock("manual");

      const approvalId = "approval-sign-message";
      const handle = wallet.approvals.create(
        {
          id: approvalId,
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
          transport: "provider",
          origin: ORIGIN,
          portId: "port-1",
          sessionId: "11111111-1111-4111-8111-111111111111",
          requestId: "request-1",
        },
      );

      expect(wallet.approvals.getState()).toEqual({
        pending: [
          expect.objectContaining({
            id: approvalId,
            kind: ApprovalKinds.SignMessage,
          }),
        ],
      });
      expect(wallet.approvals.listPendingSummaries()).toEqual([
        expect.objectContaining({
          id: approvalId,
          type: "signMessage",
          payload: expect.objectContaining({
            from: address,
            message: "0x68656c6c6f",
          }),
        }),
      ]);

      await wallet.session.unlock({ password: PASSWORD });
      await expect(wallet.approvals.resolve({ id: approvalId, action: "approve" })).resolves.toMatchObject({
        id: approvalId,
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

  it("rejects empty namespace modules", async () => {
    await expect(createArxWallet(createWalletInput({ modules: [] }))).rejects.toThrow(
      /requires at least one wallet namespace module/,
    );
  });

  it("rejects duplicate namespace modules", async () => {
    const module = createEip155WalletNamespaceModule();

    await expect(createArxWallet(createWalletInput({ modules: [module, module] }))).rejects.toThrow(
      /Duplicate wallet namespace module "eip155"/,
    );
  });

  it("keeps permissions and dappConnections separated, and clears live connections on permission loss and lock", async () => {
    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
      permissionsPort: createSeededPermissionsPort(),
    });

    try {
      const { wallet } = runtime;
      const permissionSnapshot = wallet.permissions.getConnectionSnapshot(ORIGIN, { chainRef: EIP155_CHAIN_REF });
      expect(permissionSnapshot.isConnected).toBe(true);
      expect(permissionSnapshot.accounts).toHaveLength(1);
      expect(wallet.dappConnections.getState()).toEqual({ connections: [], count: 0 });
      expect(
        wallet.snapshots.buildProviderConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE }),
      ).toMatchObject({
        snapshot: {
          namespace: EIP155_NAMESPACE,
          chain: {
            chainId: "0x1",
            chainRef: EIP155_CHAIN_REF,
          },
          isUnlocked: false,
          meta: {
            activeChainByNamespace: {
              [EIP155_NAMESPACE]: EIP155_CHAIN_REF,
            },
          },
        },
        accounts: [],
      });
      expect(
        wallet.snapshots.buildProviderConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE }).snapshot.meta
          .supportedChains,
      ).toContain(EIP155_CHAIN_REF);

      await wallet.session.initialize({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });
      expect(
        wallet.snapshots.buildProviderConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE }).accounts,
      ).toHaveLength(1);

      const connected = wallet.dappConnections.connect({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
      expect(connected).toMatchObject({
        origin: ORIGIN,
        namespace: EIP155_NAMESPACE,
        chainRef: EIP155_CHAIN_REF,
      });
      expect(
        wallet.dappConnections.buildConnectionProjection({ origin: ORIGIN, namespace: EIP155_NAMESPACE }).connected,
      ).toBe(true);
      expect(wallet.dappConnections.getState().count).toBe(1);

      await wallet.permissions.clearOrigin(ORIGIN);
      await flushAsync();
      expect(wallet.dappConnections.getState().count).toBe(0);
      expect(wallet.permissions.getConnectionSnapshot(ORIGIN, { chainRef: EIP155_CHAIN_REF }).isConnected).toBe(false);

      await wallet.permissions.upsertAuthorization(ORIGIN, {
        namespace: EIP155_NAMESPACE,
        chains: [{ chainRef: EIP155_CHAIN_REF, accountKeys: [ACCOUNT_KEY] }],
      });
      await flushAsync();
      wallet.dappConnections.connect({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
      expect(wallet.dappConnections.getState().count).toBe(1);

      wallet.session.lock("manual");
      await flushAsync();
      expect(wallet.dappConnections.getState().count).toBe(0);
      expect(wallet.permissions.getConnectionSnapshot(ORIGIN, { chainRef: EIP155_CHAIN_REF }).isConnected).toBe(true);
      expect(
        wallet.snapshots.buildProviderConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE }).accounts,
      ).toEqual([]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("builds UI snapshots from wallet session, network, and attention surfaces", async () => {
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

      expect(wallet.snapshots.buildUiSnapshot()).toMatchObject({
        vault: { initialized: false },
        session: { isUnlocked: false },
        attention: { count: 1 },
        accounts: { list: [] },
        networks: {
          selectedNamespace: wallet.networks.getSelectedNamespace(),
          active: wallet.networks.getSelectedChainView().chainRef,
        },
      });

      await wallet.session.initialize({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });

      expect(wallet.snapshots.buildUiSnapshot()).toMatchObject({
        vault: { initialized: true },
        session: { isUnlocked: true },
        attention: { count: 1 },
        accounts: {
          totalCount: 1,
        },
      });
      expect(wallet.snapshots.buildUiSnapshot().accounts.list[0]?.accountKey).toBe(ACCOUNT_KEY);
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
      await wallet.session.initialize({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });
      wallet.dappConnections.connect({ origin: ORIGIN, namespace: EIP155_NAMESPACE });
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
        reopened.wallet.permissions.getConnectionSnapshot(ORIGIN, { chainRef: EIP155_CHAIN_REF }).isConnected,
      ).toBe(true);
    } finally {
      await reopened.shutdown();
    }
  });

  it("exposes transactions and keeps cold-start approved records from auto-resuming on unlock", async () => {
    const prepareTransaction = vi.fn(async () => ({ prepared: { ready: true }, warnings: [], issues: [] }));
    const signTransaction = vi.fn(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));

    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
      transactionsPort: new MemoryTransactionsPort([
        createTransactionRecord({
          id: "33333333-3333-4333-8333-333333333333",
          status: "approved",
        }),
      ]),
      modules: [
        createWalletModuleWithTransactionAdapter({
          prepareTransaction,
          signTransaction,
          broadcastTransaction,
          receiptTracking: {
            fetchReceipt: vi.fn(async () => null),
          },
        }),
      ],
    });

    try {
      const { wallet } = runtime;

      await wallet.session.initialize({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });
      await flushAsync();

      expect(prepareTransaction).toHaveBeenCalledTimes(0);
      expect(signTransaction).toHaveBeenCalledTimes(0);
      expect(broadcastTransaction).toHaveBeenCalledTimes(0);
      expect(wallet.transactions.getMeta("33333333-3333-4333-8333-333333333333")?.status).toBe("approved");

      await wallet.transactions.processTransaction("33333333-3333-4333-8333-333333333333");

      expect(prepareTransaction).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(wallet.transactions.getMeta("33333333-3333-4333-8333-333333333333")?.status).toBe("broadcast");
    } finally {
      await runtime.shutdown();
    }
  });

  it("releases a retained cold-start transaction after an explicit retry", async () => {
    const prepareTransaction = vi.fn(async () => ({ prepared: { ready: true }, warnings: [], issues: [] }));
    const signTransaction = vi
      .fn()
      .mockRejectedValueOnce(arxError({ reason: ArxReasons.SessionLocked, message: "locked" }))
      .mockResolvedValue({
        raw: "0x1111",
        hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      });
    const broadcastTransaction = vi.fn(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));

    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
      transactionsPort: new MemoryTransactionsPort([
        createTransactionRecord({
          id: "55555555-5555-4555-8555-555555555555",
          status: "approved",
        }),
      ]),
      modules: [
        createWalletModuleWithTransactionAdapter({
          prepareTransaction,
          signTransaction,
          broadcastTransaction,
          receiptTracking: {
            fetchReceipt: vi.fn(async () => null),
          },
        }),
      ],
    });

    try {
      const { wallet } = runtime;

      await wallet.session.initialize({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });
      await flushAsync();

      expect(signTransaction).toHaveBeenCalledTimes(0);

      await wallet.transactions.processTransaction("55555555-5555-4555-8555-555555555555");

      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(0);
      expect(wallet.transactions.getMeta("55555555-5555-4555-8555-555555555555")?.status).toBe("approved");

      wallet.session.lock("manual");
      await wallet.session.unlock({ password: PASSWORD });
      await vi.waitFor(() => {
        expect(signTransaction).toHaveBeenCalledTimes(2);
      });

      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(wallet.transactions.getMeta("55555555-5555-4555-8555-555555555555")?.status).toBe("broadcast");
    } finally {
      await runtime.shutdown();
    }
  });

  it("resumes broadcast receipt tracking during engine boot", async () => {
    vi.useFakeTimers();

    const fetchReceipt = vi.fn(async () => ({
      status: "success" as const,
      receipt: {
        status: "0x1",
        blockNumber: "0x10",
      },
    }));

    const runtime = await createWalletRuntime({
      transactionsPort: new MemoryTransactionsPort([
        createTransactionRecord({
          id: "44444444-4444-4444-8444-444444444444",
          status: "broadcast",
          hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      ]),
      modules: [
        createWalletModuleWithTransactionAdapter({
          prepareTransaction: vi.fn(async () => ({ prepared: {}, warnings: [], issues: [] })),
          signTransaction: vi.fn(async () => ({ raw: "0x", hash: null })),
          broadcastTransaction: vi.fn(async () => ({
            hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          })),
          receiptTracking: {
            fetchReceipt,
          },
        }),
      ],
    });

    try {
      await flushAsync();
      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);
      expect(runtime.wallet.transactions.getMeta("44444444-4444-4444-8444-444444444444")).toMatchObject({
        status: "confirmed",
        receipt: {
          status: "0x1",
        },
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("exposes engine-owned provider dispatch and surface error encoding", async () => {
    const runtime = await createWalletRuntime({
      accountsPort: createSeededAccountsPort(),
      permissionsPort: createSeededPermissionsPort(),
    });

    try {
      const { wallet } = runtime;
      await wallet.session.initialize({ password: PASSWORD });
      await wallet.session.unlock({ password: PASSWORD });
      wallet.session.lock("manual");

      await expect(
        runtime.providerAccess.executeRpcRequest({
          id: "rpc-accounts-locked",
          jsonrpc: "2.0",
          method: "eth_accounts",
          origin: ORIGIN,
          context: createProviderRpcContext("rpc-accounts-locked"),
        }),
      ).resolves.toMatchObject({
        id: "rpc-accounts-locked",
        jsonrpc: "2.0",
        result: [],
      });

      expect(
        runtime.providerAccess.encodeRpcError(arxError({ reason: ArxReasons.PermissionDenied, message: "denied" }), {
          origin: ORIGIN,
          method: "eth_sendTransaction",
          rpcContext: createProviderRpcContext("rpc-encode"),
        }),
      ).toMatchObject({
        code: 4100,
      });

      expect(
        runtime.surfaceErrors.encodeUi(arxError({ reason: ArxReasons.RpcInternal, message: "boom" }), {
          namespace: EIP155_NAMESPACE,
          chainRef: EIP155_CHAIN_REF,
          method: "ui.test",
        }),
      ).toEqual({
        reason: ArxReasons.RpcInternal,
        message: "boom",
      });
    } finally {
      await runtime.shutdown();
    }
  });
});
