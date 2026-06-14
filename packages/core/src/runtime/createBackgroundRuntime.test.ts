import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import { ApprovalKinds } from "../approvals/index.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { eip155NamespaceManifest } from "../namespaces/index.js";
import type { NamespaceTransaction } from "../transactions/index.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type { TransactionRequest } from "../transactions/types.js";
import { createApprovalReadService } from "../ui/server/approvals/readService.js";
import { createApprovalResolveService } from "../ui/server/approvals/resolveService.js";
import { createUiKeyringsAccess } from "../ui/server/keyringsAccess.js";
import { createUiServerRuntime } from "../ui/server/runtime.js";
import { createUiSessionAccess } from "../ui/server/sessionAccess.js";
import type { UiServerExtension } from "../ui/server/types.js";
import { createUiWalletSetupAccess } from "../ui/server/walletSetupAccess.js";
import {
  flushAsync,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryKeyringMetasPort,
  MemoryPermissionsPort,
  MemoryProviderChainSelectionPort,
  MemorySettingsPort,
  MemoryTransactionAggregatesPort,
  MemoryWalletChainSelectionPort,
  TEST_MNEMONIC,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "./createBackgroundRuntime.js";

const MAINNET_CHAIN: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.mainnet", type: "public" }],
};

const ALT_CHAIN: ChainMetadata = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Alt Chain",
  nativeCurrency: { name: "Alter", symbol: "ALT", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.alt", type: "public" }],
};

const BASE_CHAIN: ChainMetadata = {
  chainRef: "eip155:8453",
  namespace: "eip155",
  chainId: "0x2105",
  displayName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.base", type: "public" }],
};

const TEST_NAMESPACE_MANIFESTS = [eip155NamespaceManifest] as const;
const DEFAULT_RPC_ACCESS_POLICY = {
  isInternalOrigin: () => false,
  shouldRequestUnlockAttention: () => false,
} as const;

const createNamespaceTransactionWithoutTracking = (): NamespaceTransaction => ({
  proposal: {
    prepare: async () => ({ status: "ready", prepared: {} }),
  },
  submission: {
    createBroadcastInput: async () => ({ kind: "test.raw", payload: { raw: "0x1111" } }),
    broadcast: async (context) => ({
      broadcastIdentity: { hash: "0x1111111111111111111111111111111111111111111111111111111111111111" },
      submitted: {
        hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        chainId: "0x1",
        from: context.from,
      },
    }),
  },
});

const createTestRuntime = (params?: {
  chainSeed?: ChainMetadata[];
  chainDefinitionsPort?: MemoryChainDefinitionsPort;
  walletChainSelectionPort?: MemoryWalletChainSelectionPort;
  providerChainSelectionPort?: MemoryProviderChainSelectionPort;
  namespaces?: Parameters<typeof createBackgroundRuntime>[0]["namespaces"];
  rpcAccessPolicy?: Parameters<typeof createBackgroundRuntime>[0]["rpcAccessPolicy"];
  settingsPort?: MemorySettingsPort;
  storePorts?: Partial<Parameters<typeof createBackgroundRuntime>[0]["store"]["ports"]>;
  supportedChains?: Omit<NonNullable<Parameters<typeof createBackgroundRuntime>[0]["supportedChains"]>, "port">;
  storage?: Parameters<typeof createBackgroundRuntime>[0]["storage"];
  session?: Parameters<typeof createBackgroundRuntime>[0]["session"];
  transactions?: Parameters<typeof createBackgroundRuntime>[0]["transactions"];
  messenger?: Parameters<typeof createBackgroundRuntime>[0]["messenger"];
  rpcClients?: Parameters<typeof createBackgroundRuntime>[0]["rpcClients"];
  approvals?: Parameters<typeof createBackgroundRuntime>[0]["approvals"];
  chainRpcDefaultEndpoints?: Parameters<typeof createBackgroundRuntime>[0]["chainRpcDefaultEndpoints"];
  chainRpcEndpointOverrides?: Parameters<typeof createBackgroundRuntime>[0]["chainRpcEndpointOverrides"];
}) => {
  const chainDefinitionsPort = params?.chainDefinitionsPort ?? new MemoryChainDefinitionsPort();
  return createBackgroundRuntime({
    supportedChains: {
      ...(params?.supportedChains ?? {}),
      ...(params?.chainSeed ? { seed: params.chainSeed } : {}),
    },
    namespaces: params?.namespaces ?? { manifests: TEST_NAMESPACE_MANIFESTS },
    rpcAccessPolicy: params?.rpcAccessPolicy ?? DEFAULT_RPC_ACCESS_POLICY,
    walletChainSelection: {
      port: params?.walletChainSelectionPort ?? new MemoryWalletChainSelectionPort(),
    },
    providerChainSelection: {
      port: params?.providerChainSelectionPort ?? new MemoryProviderChainSelectionPort(),
    },
    chainRpcDefaultEndpoints: params?.chainRpcDefaultEndpoints ?? {
      port: new MemoryChainRpcDefaultEndpointsPort(),
    },
    chainRpcEndpointOverrides: params?.chainRpcEndpointOverrides ?? {
      port: new MemoryChainRpcEndpointOverridesPort(),
    },
    settings: {
      port: params?.settingsPort ?? new MemorySettingsPort({ id: "settings", updatedAt: 0 }),
    },
    store: {
      ports: {
        chainDefinitions: chainDefinitionsPort,
        permissions: new MemoryPermissionsPort(),
        transactionAggregates: new MemoryTransactionAggregatesPort(),
        accounts: new MemoryAccountsPort(),
        keyringMetas: new MemoryKeyringMetasPort(),
        ...(params?.storePorts ?? {}),
      },
    },
    ...(params?.storage ? { storage: params.storage } : {}),
    ...(params?.session ? { session: params.session } : {}),
    ...(params?.transactions ? { transactions: params.transactions } : {}),
    ...(params?.messenger ? { messenger: params.messenger } : {}),
    ...(params?.rpcClients ? { rpcClients: params.rpcClients } : {}),
    ...(params?.approvals ? { approvals: params.approvals } : {}),
  });
};

const initializeUnlockedSession = async (runtime: ReturnType<typeof createBackgroundRuntime>) => {
  await runtime.services.session.createVault({ password: "test" });
  await runtime.services.session.unlock.unlock({ password: "test" });
};

const createActiveAccount = async (
  runtime: ReturnType<typeof createBackgroundRuntime>,
  chainRef = MAINNET_CHAIN.chainRef,
) => {
  const { address } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
  await runtime.services.accounts.setActiveAccount({
    namespace: MAINNET_CHAIN.namespace,
    chainRef,
    accountKey: toAccountKeyFromAddress({
      chainRef,
      address,
      accountCodecs: runtime.services.accountCodecs,
    }),
  });
  return address;
};

const createHandlersForRuntime = (
  runtime: ReturnType<typeof createBackgroundRuntime>,
  options?: { extensions?: readonly UiServerExtension[] },
) => {
  const session = createUiSessionAccess({
    session: runtime.services.session,
    sessionStatus: runtime.services.sessionStatus,
    keyring: runtime.services.keyring,
  });
  const approvalReadService = createApprovalReadService({
    approvals: runtime.services.approvals,
    accounts: runtime.services.accounts,
    chainViews: runtime.services.chainViews,
    transactionApprovals: runtime.transactions,
  });
  const approvalResolveService = createApprovalResolveService({
    approvals: runtime.services.approvals,
    transactions: runtime.transactions,
  });

  return createUiServerRuntime({
    access: {
      accounts: runtime.services.accounts,
      approvals: {
        read: {
          listPendingEntries: () => approvalReadService.listPending(),
          getDetail: (approvalId) => approvalReadService.getDetail(approvalId),
        },
        write: {
          resolve: (input) => approvalResolveService.resolve(input),
        },
      },
      approvalEvents: runtime.services.approvals,
      permissions: {
        buildUiPermissionsSnapshot: runtime.services.permissionViews.buildUiPermissionsSnapshot.bind(
          runtime.services.permissionViews,
        ),
      },
      transactions: {
        requestTransactionApproval: (input) => runtime.transactions.requestTransactionApproval(input),
        rerunApprovalPrepare: (input) => runtime.transactions.rerunApprovalPrepare(input),
        updateApprovalDraft: (input) => runtime.transactions.updateApprovalDraft(input),
        approveAndSubmitTransaction: (input) => runtime.transactions.approveAndSubmitTransaction(input),
        rejectTransactionApproval: (input) => runtime.transactions.rejectTransactionApproval(input),
        getTransactionApproval: (approvalId) => runtime.transactions.getTransactionApproval(approvalId),
        getTransactionApprovalByTransactionId: (transactionId) =>
          runtime.transactions.getTransactionApprovalByTransactionId(transactionId),
        getTransaction: (transactionId) => runtime.transactions.getTransaction(transactionId),
        listTransactions: (query) => runtime.transactions.listTransactions(query),
        onTransactionsChanged: (handler) => runtime.transactions.onTransactionsChanged(handler),
        onTransactionApprovalsChanged: (handler) => runtime.transactions.onTransactionApprovalsChanged(handler),
      },
      chains: {
        buildWalletNetworksSnapshot: runtime.services.chainViews.buildWalletNetworksSnapshot.bind(
          runtime.services.chainViews,
        ),
        findAvailableChainView: runtime.services.chainViews.findAvailableChainView.bind(runtime.services.chainViews),
        getApprovalReviewChainView: runtime.services.chainViews.getApprovalReviewChainView.bind(
          runtime.services.chainViews,
        ),
        getActiveChainViewForNamespace: runtime.services.chainViews.getActiveChainViewForNamespace.bind(
          runtime.services.chainViews,
        ),
        getSelectedNamespace: runtime.services.chainViews.getSelectedNamespace.bind(runtime.services.chainViews),
        getSelectedChainView: runtime.services.chainViews.getSelectedChainView.bind(runtime.services.chainViews),
        requireAvailableChainMetadata: runtime.services.chainViews.requireAvailableChainMetadata.bind(
          runtime.services.chainViews,
        ),
        selectWalletChain: runtime.services.chainActivation.selectWalletChain.bind(runtime.services.chainActivation),
      },
      accountCodecs: runtime.services.accountCodecs,
      session,
      walletSetup: createUiWalletSetupAccess({
        accounts: runtime.services.accounts,
        session: runtime.services.session,
        keyring: runtime.services.keyring,
      }),
      keyrings: createUiKeyringsAccess({
        keyring: runtime.services.keyring,
        keyringExport: runtime.services.keyringExport,
      }),
      attention: {
        getSnapshot: runtime.services.attention.getSnapshot.bind(runtime.services.attention),
      },
      namespaceBindings: runtime.services.namespaceBindings,
    },
    platform: {
      openOnboardingTab: async () => ({ activationPath: "create" }),
      openNotificationPopup: async () => ({ activationPath: "create" }),
    },
    surface: {
      transport: "ui",
      portId: "ui",
      origin: "chrome-extension://arx",
      surfaceId: "11111111-1111-4111-8111-111111111111",
    },
    ...(options?.extensions ? { extensions: options.extensions } : {}),
  }).handlers;
};

describe("createBackgroundRuntime (no snapshots)", () => {
  it("derives network selection defaults from the admitted chain seed before hydration", async () => {
    const runtime = createTestRuntime({
      chainSeed: [BASE_CHAIN],
    });

    expect(runtime.services.walletChainSelection.getSelectedNamespace()).toBe(BASE_CHAIN.namespace);
    expect(runtime.services.walletChainSelection.getChainRefByNamespace()).toEqual({
      [BASE_CHAIN.namespace]: BASE_CHAIN.chainRef,
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    expect(runtime.services.chainViews.getSelectedChainView().chainRef).toBe(BASE_CHAIN.chainRef);

    runtime.lifecycle.shutdown();
  });

  it("hydrates network selection from persisted selection state", async () => {
    const now = () => 1_000;
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const walletChainSelectionPort = new MemoryWalletChainSelectionPort({
      id: "wallet-chain-selection",
      selectedNamespace: ALT_CHAIN.namespace,
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: now(),
    });

    const runtime = createTestRuntime({
      chainSeed,
      walletChainSelectionPort,
      storage: {
        vaultMetaPort: {
          loadVaultMeta: async () => null,
          saveVaultMeta: async () => {},
          clearVaultMeta: async () => {},
        },
        now,
      },
    });

    await flushAsync();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chainRpcState = runtime.services.chainRpc.getState();
    expect(runtime.services.walletChainSelection.getSelectedNamespace()).toBe(ALT_CHAIN.namespace);
    expect(runtime.services.chainViews.getSelectedChainView().chainRef).toBe(ALT_CHAIN.chainRef);
    expect(chainRpcState.accesses.map((access) => access.chainRef)).toEqual([
      MAINNET_CHAIN.chainRef,
      ALT_CHAIN.chainRef,
    ]);
    expect(runtime.services.chainRpc.getEndpoints(ALT_CHAIN.chainRef)[0].url).toBe("https://rpc.alt");

    runtime.lifecycle.shutdown();
  });

  it("does not hydrate provider chain selection when storage hydration is disabled", async () => {
    const providerChainSelectionPort = new MemoryProviderChainSelectionPort([
      {
        origin: "https://dapp.example",
        namespace: MAINNET_CHAIN.namespace,
        chainRef: MAINNET_CHAIN.chainRef,
        updatedAt: 1,
      },
    ]);
    const listAll = vi.spyOn(providerChainSelectionPort, "listAll");
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      providerChainSelectionPort,
      storage: {
        hydrate: false,
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    expect(listAll).not.toHaveBeenCalled();
    expect(
      runtime.services.providerChainSelection.getSelectedChainRef({
        origin: "https://dapp.example",
        namespace: MAINNET_CHAIN.namespace,
      }),
    ).toBeNull();

    runtime.lifecycle.shutdown();
  });

  it("prefers explicit session keyring namespaces over the default session stage output", () => {
    const overriddenKeyringNamespaces = [
      {
        ...eip155NamespaceManifest.core.keyring,
        defaultChainRef: ALT_CHAIN.chainRef,
        factories: { ...eip155NamespaceManifest.core.keyring.factories },
      },
    ];

    const runtime = createTestRuntime({
      chainSeed: [ALT_CHAIN],
      session: {
        keyringNamespaces: overriddenKeyringNamespaces,
      },
    });

    expect(runtime.services.keyring.getNamespaces()[0]?.defaultChainRef).toBe(ALT_CHAIN.chainRef);
    expect(runtime.services.keyring.getNamespaces()[0]).not.toBe(overriddenKeyringNamespaces[0]);

    runtime.lifecycle.shutdown();
  });

  it("resolves unlocked session state through ui.session.unlock", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await runtime.services.session.createVault({ password: "test" });

    const handlers = createHandlersForRuntime(runtime);
    const result = await handlers["ui.session.unlock"]({ password: "test" });

    expect(result).toMatchObject({
      status: "unlocked",
    });
    runtime.lifecycle.shutdown();
  });

  it("persists selectedNamespace-derived UI chain when ui.networks.switchActive succeeds", async () => {
    const now = () => 10_000;
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const walletChainSelectionPort = new MemoryWalletChainSelectionPort({
      id: "wallet-chain-selection",
      selectedNamespace: MAINNET_CHAIN.namespace,
      chainRefByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      updatedAt: 0,
    });

    const runtime = createTestRuntime({
      chainSeed,
      walletChainSelectionPort,
      storage: {
        vaultMetaPort: {
          loadVaultMeta: async () => null,
          saveVaultMeta: async () => {},
          clearVaultMeta: async () => {},
        },
        now,
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const handlers = createHandlersForRuntime(runtime);

    expect(walletChainSelectionPort.saved.length).toBe(0);
    await handlers["ui.networks.switchActive"]({ chainRef: ALT_CHAIN.chainRef });
    await flushAsync();

    expect(walletChainSelectionPort.saved.length).toBeGreaterThan(0);
    await expect(walletChainSelectionPort.get()).resolves.toMatchObject({
      selectedNamespace: ALT_CHAIN.namespace,
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
    });

    runtime.lifecycle.shutdown();
  });

  it("does not change permissions when ui.networks.switchActive succeeds", async () => {
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const runtime = createTestRuntime({
      chainSeed,
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.permissions.grantAuthorization("https://dapp.example", {
      namespace: MAINNET_CHAIN.namespace,
      chains: [
        {
          chainRef: MAINNET_CHAIN.chainRef,
          accountKeys: [
            toAccountKeyFromAddress({
              chainRef: MAINNET_CHAIN.chainRef,
              address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              accountCodecs: runtime.services.accountCodecs,
            }),
          ],
        },
      ],
    });

    const handlers = createHandlersForRuntime(runtime);

    const before = structuredClone(runtime.services.permissions.getState());
    await handlers["ui.networks.switchActive"]({ chainRef: ALT_CHAIN.chainRef });

    expect(runtime.services.permissions.getState()).toEqual(before);

    runtime.lifecycle.shutdown();
  });

  it("does not change permissions when switch-chain approval is approved", async () => {
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const runtime = createTestRuntime({
      chainSeed,
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.permissions.grantAuthorization("https://dapp.example", {
      namespace: MAINNET_CHAIN.namespace,
      chains: [
        {
          chainRef: MAINNET_CHAIN.chainRef,
          accountKeys: [
            toAccountKeyFromAddress({
              chainRef: MAINNET_CHAIN.chainRef,
              address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              accountCodecs: runtime.services.accountCodecs,
            }),
          ],
        },
      ],
    });

    const handlers = createHandlersForRuntime(runtime);

    const approvalPromise = runtime.services.approvals.create(
      {
        approvalId: "switch-chain-approval",
        kind: ApprovalKinds.SwitchChain,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: ALT_CHAIN.chainRef,
        createdAt: 1,
        request: { chainRef: ALT_CHAIN.chainRef },
      },
      {
        origin: "https://dapp.example",
        initiator: "dapp",
        requestId: "request-1",
      },
    ).settled;

    await flushAsync();

    const before = structuredClone(runtime.services.permissions.getState());
    await expect(
      handlers["ui.approvals.resolve"]({ approvalId: "switch-chain-approval", action: "approve" }),
    ).resolves.toBeNull();
    await expect(approvalPromise).resolves.toBeNull();
    expect(runtime.services.permissions.getState()).toEqual(before);

    runtime.lifecycle.shutdown();
  });

  it("resolves ui.balances.getNative via namespace runtime bindings", async () => {
    const getBalance = vi.fn(async () => "0xde0b6b3a7640000");
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      rpcClients: {
        factories: [
          {
            namespace: "eip155",
            factory: () =>
              ({
                request: vi.fn(),
                getBalance,
              }) as never,
          },
        ],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);

    expect(runtime.services.namespaceRuntimeSupport.get("eip155")).toMatchObject({
      namespace: "eip155",
      hasRpcClient: true,
      hasSigner: true,
      hasApprovalBindings: true,
      hasUiBindings: true,
      hasTransaction: true,
      hasTransactionReceiptTracking: true,
    });

    const handlers = createHandlersForRuntime(runtime);

    await expect(
      handlers["ui.balances.getNative"]({
        chainRef: MAINNET_CHAIN.chainRef,
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).resolves.toMatchObject({
      chainRef: MAINNET_CHAIN.chainRef,
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      amountWei: "1000000000000000000",
    });
    expect(getBalance).toHaveBeenCalledWith("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
      blockTag: "latest",
      timeoutMs: 15_000,
    });

    runtime.lifecycle.shutdown();
  });

  it("fails closed when sign approvals are unsupported for the namespace", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createApprovalBindings: undefined,
            },
          },
        ],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const approvalPromise = runtime.services.approvals.create(
      {
        approvalId: "sign-message-approval",
        kind: ApprovalKinds.SignMessage,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: MAINNET_CHAIN.chainRef,
        createdAt: 1,
        request: {
          chainRef: MAINNET_CHAIN.chainRef,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          message: "0x68656c6c6f",
        },
      },
      {
        origin: "https://dapp.example",
        initiator: "dapp",
        requestId: "request-1",
      },
    ).settled;

    await expect(
      runtime.services.approvals.resolve({ approvalId: "sign-message-approval", action: "approve" }),
    ).rejects.toMatchObject({
      code: "chain.not_compatible",
    });
    await expect(approvalPromise).rejects.toMatchObject({
      code: "chain.not_compatible",
    });
    expect(runtime.services.approvals.getState().pending).toEqual([]);

    runtime.lifecycle.shutdown();
  });

  it("tracks rpc client support separately from other runtime support", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              clientFactory: undefined,
              createUiBindings: () => ({
                getNativeBalance: async () => 0n,
              }),
            },
          },
        ],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    expect(runtime.services.namespaceRuntimeSupport.get("eip155")).toMatchObject({
      namespace: "eip155",
      hasRpcClient: false,
      hasSigner: true,
      hasApprovalBindings: true,
      hasUiBindings: true,
      hasTransaction: true,
      hasTransactionReceiptTracking: true,
    });

    runtime.lifecycle.shutdown();
  });

  it("derives selected-chain UI capabilities from transaction submission support", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createTransaction: createNamespaceTransactionWithoutTracking,
              createUiBindings: () => ({
                getNativeBalance: async () => 0n,
                createSendTransactionRequest: () => ({
                  namespace: "eip155",
                  chainRef: MAINNET_CHAIN.chainRef,
                  payload: {
                    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    value: "0x0",
                  },
                }),
              }),
            },
          },
        ],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);

    const handlers = createHandlersForRuntime(runtime);

    await expect(handlers["ui.snapshot.get"]()).resolves.toMatchObject({
      chainCapabilities: {
        nativeBalance: true,
        sendTransaction: true,
      },
    });

    runtime.lifecycle.shutdown();
  });

  it("creates send transaction approvals when receipt tracking is unsupported", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createUiBindings: () => ({
                getNativeBalance: async () => 0n,
                createSendTransactionRequest: () => ({
                  namespace: "eip155",
                  chainRef: MAINNET_CHAIN.chainRef,
                  payload: {
                    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    value: "0x0",
                  },
                }),
              }),
              createTransaction: createNamespaceTransactionWithoutTracking,
            },
          },
        ],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);
    await createActiveAccount(runtime);

    const handlers = createHandlersForRuntime(runtime);

    await expect(
      handlers["ui.transactions.requestSendTransactionApproval"]({
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        valueEther: "0.01",
        chainRef: MAINNET_CHAIN.chainRef,
      }),
    ).resolves.toMatchObject({
      approvalId: expect.any(String),
    });

    await expect(runtime.transactions.listTransactionApprovals()).resolves.toHaveLength(1);
    expect(runtime.services.approvals.getState().pending).toHaveLength(0);

    runtime.lifecycle.shutdown();
  });

  it("projects transaction submission capability from overridden namespace transactions", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createUiBindings: () => ({
                getNativeBalance: async () => 0n,
                createSendTransactionRequest: () => ({
                  namespace: "eip155",
                  chainRef: MAINNET_CHAIN.chainRef,
                  payload: {
                    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    value: "0x0",
                  },
                }),
              }),
            },
          },
        ],
      },
      transactions: {
        namespaces: new NamespaceTransactions([["eip155", createNamespaceTransactionWithoutTracking()]]),
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);

    expect(runtime.services.namespaceRuntimeSupport.get("eip155")).toMatchObject({
      hasTransaction: true,
      hasTransactionReceiptTracking: false,
    });
    expect(runtime.services.namespaceBindings.hasTransaction("eip155")).toBe(true);
    expect(runtime.services.namespaceBindings.hasTransactionReceiptTracking("eip155")).toBe(false);

    const handlers = createHandlersForRuntime(runtime);
    await expect(handlers["ui.snapshot.get"]()).resolves.toMatchObject({
      chainCapabilities: {
        nativeBalance: true,
        sendTransaction: true,
      },
    });

    runtime.lifecycle.shutdown();
  });

  it("prefers overridden namespace transactions over manifest transaction construction", async () => {
    const createTransaction = vi.fn(() => {
      throw new Error("manifest transaction should not be constructed");
    });

    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createTransaction,
            },
          },
        ],
      },
      transactions: {
        namespaces: new NamespaceTransactions([["eip155", createNamespaceTransactionWithoutTracking()]]),
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    expect(createTransaction).not.toHaveBeenCalled();
    expect(runtime.services.namespaceRuntimeSupport.get("eip155")).toMatchObject({
      hasTransaction: true,
      hasTransactionReceiptTracking: false,
    });

    runtime.lifecycle.shutdown();
  });

  it("builds send-transaction requests through namespace UI bindings", async () => {
    const createSendTransactionRequest = vi.fn(
      ({ chainRef, to, valueWei }: { chainRef: string; to: string; valueWei: bigint }) =>
        ({
          namespace: "eip155",
          chainRef,
          payload: {
            to,
            value: `0x${valueWei.toString(16)}` as `0x${string}`,
          },
        }) satisfies TransactionRequest,
    );

    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createUiBindings: () => ({
                getNativeBalance: async () => 0n,
                createSendTransactionRequest,
              }),
            },
          },
        ],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);
    const from = await createActiveAccount(runtime);

    const handlers = createHandlersForRuntime(runtime);

    const result = await handlers["ui.transactions.requestSendTransactionApproval"]({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      valueEther: "0.01",
      chainRef: MAINNET_CHAIN.chainRef,
    });
    await flushAsync();

    expect(createSendTransactionRequest).toHaveBeenCalledWith({
      chainRef: MAINNET_CHAIN.chainRef,
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      valueWei: 10_000_000_000_000_000n,
    });
    expect(result).toEqual({ approvalId: expect.any(String) });
    await expect(runtime.transactions.listTransactionApprovals()).resolves.toEqual([
      expect.objectContaining({
        approvalId: result.approvalId,
        origin: "chrome-extension://arx",
        account: expect.objectContaining({
          address: from,
        }),
      }),
    ]);

    runtime.lifecycle.shutdown();
  });

  it("rejects extension handlers that override common UI methods", () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
    });

    const overrideResolveExtension = {
      id: "test.overrideResolve",
      createHandlers: () => ({
        "ui.approvals.resolve": (async () => ({
          approvalId: "approval-id",
          status: "rejected" as const,
          terminalReason: "user_reject" as const,
        })) as never,
      }),
    } satisfies UiServerExtension;

    expect(() => createHandlersForRuntime(runtime, { extensions: [overrideResolveExtension] })).toThrow(
      'UI method "ui.approvals.resolve" is already registered by "core.uiCommon" and cannot be registered again by "test.overrideResolve"',
    );
  });

  it("rejects conflicting UI methods across extensions", () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
    });

    const firstActivationExtension = {
      id: "test.activationOne",
      createHandlers: () => ({
        "ui.onboarding.openTab": (async () => ({ activationPath: "create" as const })) as never,
      }),
    } satisfies UiServerExtension;

    const secondActivationExtension = {
      id: "test.activationTwo",
      createHandlers: () => ({
        "ui.onboarding.openTab": (async () => ({ activationPath: "focus" as const })) as never,
      }),
    } satisfies UiServerExtension;

    expect(() =>
      createHandlersForRuntime(runtime, { extensions: [firstActivationExtension, secondActivationExtension] }),
    ).toThrow(
      'UI method "ui.onboarding.openTab" is already registered by "test.activationOne" and cannot be registered again by "test.activationTwo"',
    );
  });

  it("reuses one UI surface correlation token per UiRuntimeAccess instance", async () => {
    const createSendTransactionRequest = vi.fn(
      ({ chainRef, to, valueWei }: { chainRef: string; to: string; valueWei: bigint }) =>
        ({
          namespace: "eip155",
          chainRef,
          payload: {
            to,
            value: `0x${valueWei.toString(16)}` as `0x${string}`,
          },
        }) satisfies TransactionRequest,
    );

    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createUiBindings: () => ({
                getNativeBalance: async () => 0n,
                createSendTransactionRequest,
              }),
            },
          },
        ],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);
    await createActiveAccount(runtime);

    const platform = {
      openOnboardingTab: async () => ({ activationPath: "create" as const }),
      openNotificationPopup: async () => ({ activationPath: "create" as const }),
    };

    const firstUiAccess = runtime.createUiAccess({
      platform,
      uiOrigin: "chrome-extension://arx",
    });

    await firstUiAccess.dispatchRequest({
      type: "ui:request",
      id: "1",
      method: "ui.transactions.requestSendTransactionApproval",
      params: {
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        valueEther: "0.01",
        chainRef: MAINNET_CHAIN.chainRef,
      },
    });
    await firstUiAccess.dispatchRequest({
      type: "ui:request",
      id: "2",
      method: "ui.transactions.requestSendTransactionApproval",
      params: {
        to: "0xcccccccccccccccccccccccccccccccccccccccc",
        valueEther: "0.02",
        chainRef: MAINNET_CHAIN.chainRef,
      },
    });

    const secondUiAccess = runtime.createUiAccess({
      platform,
      uiOrigin: "chrome-extension://arx",
    });

    await secondUiAccess.dispatchRequest({
      type: "ui:request",
      id: "3",
      method: "ui.transactions.requestSendTransactionApproval",
      params: {
        to: "0xdddddddddddddddddddddddddddddddddddddddd",
        valueEther: "0.03",
        chainRef: MAINNET_CHAIN.chainRef,
      },
    });

    expect(createSendTransactionRequest).toHaveBeenCalledTimes(3);
    await expect(runtime.transactions.listTransactionApprovals()).resolves.toHaveLength(3);

    runtime.lifecycle.shutdown();
  });

  it("propagates transaction approval creation errors to the UI handler", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);
    await createActiveAccount(runtime);

    vi.spyOn(runtime.transactions, "requestTransactionApproval").mockRejectedValue(new Error("create approval failed"));

    const handlers = createHandlersForRuntime(runtime);

    await expect(
      handlers["ui.transactions.requestSendTransactionApproval"]({
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        valueEther: "0.01",
        chainRef: MAINNET_CHAIN.chainRef,
      }),
    ).rejects.toThrow("create approval failed");

    runtime.lifecycle.shutdown();
  });
});
