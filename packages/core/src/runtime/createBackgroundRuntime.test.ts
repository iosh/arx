import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { ApprovalKinds } from "../controllers/index.js";
import { eip155NamespaceManifest } from "../namespaces/index.js";
import type { TransactionRequest } from "../transactions/types.js";
import { createApprovalReadService } from "../ui/server/approvals/readService.js";
import { createUiKeyringsAccess } from "../ui/server/keyringsAccess.js";
import { createUiServerRuntime } from "../ui/server/runtime.js";
import { createUiSessionAccess } from "../ui/server/sessionAccess.js";
import type { UiServerExtension } from "../ui/server/types.js";
import { createUiWalletSetupAccess } from "../ui/server/walletSetupAccess.js";
import {
  flushAsync,
  MemoryAccountsPort,
  MemoryCustomChainsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkSelectionPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
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
const DEFAULT_RPC_ENGINE = {
  env: {
    isInternalOrigin: () => false,
    shouldRequestUnlockAttention: () => false,
  },
} as const;

const createTestRuntime = (params?: {
  chainSeed?: ChainMetadata[];
  customChainsPort?: MemoryCustomChainsPort;
  networkSelectionPort?: MemoryNetworkSelectionPort;
  namespaces?: Parameters<typeof createBackgroundRuntime>[0]["namespaces"];
  rpcEngine?: Parameters<typeof createBackgroundRuntime>[0]["rpcEngine"];
  settingsPort?: MemorySettingsPort;
  storePorts?: Partial<Parameters<typeof createBackgroundRuntime>[0]["store"]["ports"]>;
  supportedChains?: Omit<NonNullable<Parameters<typeof createBackgroundRuntime>[0]["supportedChains"]>, "port">;
  storage?: Parameters<typeof createBackgroundRuntime>[0]["storage"];
  session?: Parameters<typeof createBackgroundRuntime>[0]["session"];
  transactions?: Parameters<typeof createBackgroundRuntime>[0]["transactions"];
  messenger?: Parameters<typeof createBackgroundRuntime>[0]["messenger"];
  network?: Parameters<typeof createBackgroundRuntime>[0]["network"];
  rpcClients?: Parameters<typeof createBackgroundRuntime>[0]["rpcClients"];
  accounts?: Parameters<typeof createBackgroundRuntime>[0]["accounts"];
  approvals?: Parameters<typeof createBackgroundRuntime>[0]["approvals"];
  customRpc?: Parameters<typeof createBackgroundRuntime>[0]["customRpc"];
  engine?: Parameters<typeof createBackgroundRuntime>[0]["engine"];
}) => {
  const customChainsPort = params?.customChainsPort ?? new MemoryCustomChainsPort();
  return createBackgroundRuntime({
    supportedChains: {
      port: customChainsPort,
      ...(params?.chainSeed ? { seed: params.chainSeed } : {}),
      ...(params?.supportedChains ?? {}),
    },
    namespaces: params?.namespaces ?? { manifests: TEST_NAMESPACE_MANIFESTS },
    rpcEngine: params?.rpcEngine ?? DEFAULT_RPC_ENGINE,
    networkSelection: {
      port: params?.networkSelectionPort ?? new MemoryNetworkSelectionPort(),
    },
    settings: {
      port: params?.settingsPort ?? new MemorySettingsPort({ id: "settings", updatedAt: 0 }),
    },
    store: {
      ports: {
        customChains: customChainsPort,
        permissions: new MemoryPermissionsPort(),
        transactions: new MemoryTransactionsPort(),
        accounts: new MemoryAccountsPort(),
        keyringMetas: new MemoryKeyringMetasPort(),
        ...(params?.storePorts ?? {}),
      },
    },
    ...(params?.storage ? { storage: params.storage } : {}),
    ...(params?.session ? { session: params.session } : {}),
    ...(params?.transactions ? { transactions: params.transactions } : {}),
    ...(params?.messenger ? { messenger: params.messenger } : {}),
    ...(params?.network ? { network: params.network } : {}),
    ...(params?.rpcClients ? { rpcClients: params.rpcClients } : {}),
    ...(params?.accounts ? { accounts: params.accounts } : {}),
    ...(params?.approvals ? { approvals: params.approvals } : {}),
    ...(params?.customRpc ? { customRpc: params.customRpc } : {}),
    ...(params?.engine ? { engine: params.engine } : {}),
  });
};

const initializeUnlockedSession = async (runtime: ReturnType<typeof createBackgroundRuntime>) => {
  await runtime.services.session.createVault({ password: "test" });
  await runtime.services.session.unlock.unlock({ password: "test" });
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
    approvals: runtime.controllers.approvals,
    accounts: runtime.controllers.accounts,
    chainViews: runtime.services.chainViews,
    transactions: runtime.controllers.transactions,
  });

  return createUiServerRuntime({
    access: {
      accounts: runtime.controllers.accounts,
      approvals: {
        read: {
          listPendingEntries: () => approvalReadService.listPending(),
          getDetail: (approvalId) => approvalReadService.getDetail(approvalId),
          listAffectedApprovalIds: (change) => approvalReadService.listAffectedApprovalIds(change),
        },
        write: {
          resolve: runtime.controllers.approvals.resolve.bind(runtime.controllers.approvals),
        },
      },
      approvalEvents: runtime.controllers.approvals,
      permissions: {
        buildUiPermissionsSnapshot: runtime.services.permissionViews.buildUiPermissionsSnapshot.bind(
          runtime.services.permissionViews,
        ),
      },
      transactions: runtime.controllers.transactions,
      transactionEvents: runtime.controllers.transactions,
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
        accounts: runtime.controllers.accounts,
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
    const customChainsPort = new MemoryCustomChainsPort();
    const runtime = createTestRuntime({
      chainSeed: [BASE_CHAIN],
      customChainsPort,
    });

    expect(runtime.services.networkSelection.getSelectedNamespace()).toBe(BASE_CHAIN.namespace);
    expect(runtime.services.networkSelection.getChainRefByNamespace()).toEqual({
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
    const customChainsPort = new MemoryCustomChainsPort();
    const networkSelectionPort = new MemoryNetworkSelectionPort({
      id: "network-selection",
      selectedNamespace: ALT_CHAIN.namespace,
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: now(),
    });

    const runtime = createTestRuntime({
      chainSeed,
      customChainsPort,
      networkSelectionPort,
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

    const networkState = runtime.controllers.network.getState();
    expect(runtime.services.networkSelection.getSelectedNamespace()).toBe(ALT_CHAIN.namespace);
    expect(runtime.services.chainViews.getSelectedChainView().chainRef).toBe(ALT_CHAIN.chainRef);
    expect(networkState.availableChainRefs).toEqual([MAINNET_CHAIN.chainRef, ALT_CHAIN.chainRef]);
    expect(networkState.rpc[ALT_CHAIN.chainRef]?.strategy.id).toBe("round-robin");

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
      customChainsPort: new MemoryCustomChainsPort(),
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
      customChainsPort: new MemoryCustomChainsPort(),
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await runtime.services.session.createVault({ password: "test" });

    const handlers = createHandlersForRuntime(runtime);
    const result = await handlers["ui.session.unlock"]({ password: "test" });

    expect(result).toMatchObject({
      isUnlocked: true,
    });
    runtime.lifecycle.shutdown();
  });

  it("persists selectedNamespace-derived UI chain when ui.networks.switchActive succeeds", async () => {
    const now = () => 10_000;
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const customChainsPort = new MemoryCustomChainsPort();
    const networkSelectionPort = new MemoryNetworkSelectionPort({
      id: "network-selection",
      selectedNamespace: MAINNET_CHAIN.namespace,
      chainRefByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      updatedAt: 0,
    });

    const runtime = createTestRuntime({
      chainSeed,
      customChainsPort,
      networkSelectionPort,
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

    expect(networkSelectionPort.saved.length).toBe(0);
    await handlers["ui.networks.switchActive"]({ chainRef: ALT_CHAIN.chainRef });
    await flushAsync();

    expect(networkSelectionPort.saved.length).toBeGreaterThan(0);
    await expect(networkSelectionPort.get()).resolves.toMatchObject({
      selectedNamespace: ALT_CHAIN.namespace,
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
    });

    runtime.lifecycle.shutdown();
  });

  it("does not change permissions when ui.networks.switchActive succeeds", async () => {
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const runtime = createTestRuntime({
      chainSeed,
      customChainsPort: new MemoryCustomChainsPort(),
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.controllers.permissions.grantAuthorization("https://dapp.example", {
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

    const before = structuredClone(runtime.controllers.permissions.getState());
    await handlers["ui.networks.switchActive"]({ chainRef: ALT_CHAIN.chainRef });

    expect(runtime.controllers.permissions.getState()).toEqual(before);

    runtime.lifecycle.shutdown();
  });

  it("does not change permissions when switch-chain approval is approved", async () => {
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const runtime = createTestRuntime({
      chainSeed,
      customChainsPort: new MemoryCustomChainsPort(),
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.controllers.permissions.grantAuthorization("https://dapp.example", {
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

    const approvalPromise = runtime.controllers.approvals.create(
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
        transport: "provider",
        portId: "port-1",
        sessionId: "session-1",
        requestId: "request-1",
        origin: "https://dapp.example",
      },
    ).settled;

    await flushAsync();

    const before = structuredClone(runtime.controllers.permissions.getState());
    await expect(
      handlers["ui.approvals.resolve"]({ approvalId: "switch-chain-approval", action: "approve" }),
    ).resolves.toBeNull();
    await expect(approvalPromise).resolves.toBeNull();
    expect(runtime.controllers.permissions.getState()).toEqual(before);

    runtime.lifecycle.shutdown();
  });

  it("resolves ui.balances.getNative via namespace runtime bindings", async () => {
    const getBalance = vi.fn(async () => "0xde0b6b3a7640000");
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      customChainsPort: new MemoryCustomChainsPort(),
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
      hasTransactionReplacementTracking: true,
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
      customChainsPort: new MemoryCustomChainsPort(),
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

    const approvalPromise = runtime.controllers.approvals.create(
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
        transport: "provider",
        portId: "port-1",
        sessionId: "session-1",
        requestId: "request-1",
        origin: "https://dapp.example",
      },
    ).settled;

    await expect(
      runtime.controllers.approvals.resolve({ approvalId: "sign-message-approval", action: "approve" }),
    ).rejects.toMatchObject({
      reason: "ChainNotCompatible",
    });
    await expect(approvalPromise).rejects.toMatchObject({
      reason: "ChainNotCompatible",
    });
    expect(runtime.controllers.approvals.getState().pending).toEqual([]);

    runtime.lifecycle.shutdown();
  });

  it("tracks rpc client support separately from other runtime support", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      customChainsPort: new MemoryCustomChainsPort(),
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
      hasTransactionReplacementTracking: true,
    });

    runtime.lifecycle.shutdown();
  });

  it("derives selected-chain UI capabilities from receipt-tracked transaction support", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      customChainsPort: new MemoryCustomChainsPort(),
      namespaces: {
        manifests: [
          {
            ...eip155NamespaceManifest,
            runtime: {
              ...eip155NamespaceManifest.runtime,
              createTransactionAdapter: () => ({
                prepareTransaction: async () => ({ prepared: {}, warnings: [], issues: [] }),
                signTransaction: async () => ({ raw: "0x1111", hash: null }),
                broadcastTransaction: async () => ({
                  hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
                }),
              }),
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
        sendTransaction: false,
      },
    });

    runtime.lifecycle.shutdown();
  });

  it("fails closed when ui.transactions.requestSendTransactionApproval lacks receipt-tracked transaction support", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      customChainsPort: new MemoryCustomChainsPort(),
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
              createTransactionAdapter: () => ({
                prepareTransaction: async () => ({ prepared: {}, warnings: [], issues: [] }),
                signTransaction: async () => ({ raw: "0x1111", hash: null }),
                broadcastTransaction: async () => ({
                  hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
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

    await expect(
      handlers["ui.transactions.requestSendTransactionApproval"]({
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        valueEther: "0.01",
        chainRef: MAINNET_CHAIN.chainRef,
      }),
    ).rejects.toMatchObject({
      reason: "ChainNotSupported",
    });

    expect(runtime.controllers.approvals.getState().pending).toEqual([]);

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
      customChainsPort: new MemoryCustomChainsPort(),
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

    const approvalId = "33333333-3333-4333-8333-333333333333";
    const beginTransactionApproval = vi
      .spyOn(runtime.controllers.transactions, "beginTransactionApproval")
      .mockImplementation(async (request) => ({
        transactionId: approvalId,
        approvalId,
        pendingMeta: { id: approvalId, request } as never,
        waitForApprovalDecision: async () => ({ id: approvalId }) as never,
      }));

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
    expect(result).toEqual({ approvalId });
    expect(beginTransactionApproval).toHaveBeenCalledWith(
      {
        namespace: "eip155",
        chainRef: MAINNET_CHAIN.chainRef,
        payload: {
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x2386f26fc10000",
        },
      },
      expect.objectContaining({
        transport: "ui",
        portId: "ui",
        sessionId: "11111111-1111-4111-8111-111111111111",
        requestId: expect.any(String),
        origin: "chrome-extension://arx",
      }),
    );

    runtime.lifecycle.shutdown();
  });

  it("rejects extension handlers that override common UI methods", () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      customChainsPort: new MemoryCustomChainsPort(),
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
      customChainsPort: new MemoryCustomChainsPort(),
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
      customChainsPort: new MemoryCustomChainsPort(),
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

    const beginTransactionApproval = vi
      .spyOn(runtime.controllers.transactions, "beginTransactionApproval")
      .mockImplementation(async (request, requester) => ({
        transactionId: requester.sessionId,
        approvalId: requester.sessionId,
        pendingMeta: { id: requester.sessionId, request } as never,
        waitForApprovalDecision: async () => ({ id: requester.sessionId }) as never,
      }));

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

    expect(beginTransactionApproval).toHaveBeenCalledTimes(3);

    const firstSurfaceId = beginTransactionApproval.mock.calls[0]?.[1].sessionId;
    const repeatedSurfaceId = beginTransactionApproval.mock.calls[1]?.[1].sessionId;
    const secondSurfaceId = beginTransactionApproval.mock.calls[2]?.[1].sessionId;

    expect(firstSurfaceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(repeatedSurfaceId).toBe(firstSurfaceId);
    expect(secondSurfaceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(secondSurfaceId).not.toBe(firstSurfaceId);

    runtime.lifecycle.shutdown();
  });

  it("propagates transaction approval creation errors to the UI handler", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
      customChainsPort: new MemoryCustomChainsPort(),
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await initializeUnlockedSession(runtime);

    vi.spyOn(runtime.controllers.transactions, "beginTransactionApproval").mockRejectedValue(
      new Error("create approval failed"),
    );

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
