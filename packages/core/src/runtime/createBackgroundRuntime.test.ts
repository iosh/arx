import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import { ApprovalKinds } from "../approvals/index.js";
import type { ChainDefinitionSeed } from "../chains/definition.js";
import { type ChainMetadata, deriveChainDefinitionFromMetadata, type RpcEndpoint } from "../chains/metadata.js";
import {
  createWalletAccounts,
  createWalletApprovals,
  createWalletNetworks,
  createWalletSession,
} from "../engine/wallet.js";
import { eip155NamespaceManifest } from "../namespaces/index.js";
import type { NamespaceTransaction } from "../transactions/index.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import { createUiServerRuntime } from "../ui/server/runtime.js";
import type { UiServerExtension } from "../ui/server/types.js";
import { createApprovalDetails } from "../wallet/approval-details.js";
import { createTrustedWalletApi } from "../wallet/createTrustedWalletApi.js";
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

type TestChain = ChainMetadata & {
  defaultRpcEndpoints: readonly RpcEndpoint[];
};

const toChainDefinitionSeed = (chain: TestChain): ChainDefinitionSeed<RpcEndpoint> => ({
  definition: deriveChainDefinitionFromMetadata(chain),
  defaultRpcEndpoints: [...chain.defaultRpcEndpoints],
});

const MAINNET_CHAIN: TestChain = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  defaultRpcEndpoints: [{ url: "https://rpc.mainnet", type: "public" }],
};

const ALT_CHAIN: TestChain = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Alt Chain",
  nativeCurrency: { name: "Alter", symbol: "ALT", decimals: 18 },
  defaultRpcEndpoints: [{ url: "https://rpc.alt", type: "public" }],
};

const BASE_CHAIN: TestChain = {
  chainRef: "eip155:8453",
  namespace: "eip155",
  chainId: "0x2105",
  displayName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  defaultRpcEndpoints: [{ url: "https://rpc.base", type: "public" }],
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
    createBroadcastArtifact: async () => ({ kind: "test.raw", payload: { raw: "0x1111" } }),
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
  chainSeed?: TestChain[];
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
      ...(params?.chainSeed ? { seed: params.chainSeed.map(toChainDefinitionSeed) } : {}),
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

const createTrustedWalletApiForRuntime = (runtime: ReturnType<typeof createBackgroundRuntime>) => {
  const approvalDetails = createApprovalDetails({
    approvals: runtime.services.approvals,
    accounts: runtime.services.accounts,
    chainViews: runtime.services.chainViews,
    transactionApprovals: runtime.transactions,
  });
  const walletAccounts = createWalletAccounts({
    accounts: runtime.services.accounts,
    keyring: runtime.services.keyring,
    keyringExport: runtime.services.keyringExport,
  });
  const walletSession = createWalletSession({
    session: runtime.services.session,
    sessionStatus: runtime.services.sessionStatus,
    keyring: runtime.services.keyring,
  });
  const walletNetworks = createWalletNetworks({
    walletChainSelection: runtime.services.walletChainSelection,
    supportedChains: runtime.services.supportedChains,
    chainRpcEndpointOverrides: runtime.services.chainRpcEndpointOverrides,
    chainViews: runtime.services.chainViews,
    chainActivation: runtime.services.chainActivation,
    chainRpc: runtime.services.chainRpc,
  });
  return createTrustedWalletApi({
    session: walletSession,
    accounts: walletAccounts,
    networks: walletNetworks,
    approvals: createWalletApprovals({
      approvals: runtime.services.approvals,
    }),
    approvalDetails: {
      listPending: () => approvalDetails.listPending(),
      getDetail: (approvalId) => approvalDetails.getDetail(approvalId),
    },
    accountCodecs: runtime.services.accountCodecs,
    createId: () => crypto.randomUUID(),
    surface: {
      origin: "chrome-extension://arx",
    },
    namespaceBindings: runtime.services.namespaceBindings,
    transactions: runtime.transactions,
  });
};

const createHandlersForRuntime = (
  runtime: ReturnType<typeof createBackgroundRuntime>,
  options?: { extensions?: readonly UiServerExtension[] },
) => {
  const wallet = createTrustedWalletApiForRuntime(runtime);

  return createUiServerRuntime({
    wallet,
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

  it("resolves unlocked session state through wallet.session.unlock", async () => {
    const runtime = createTestRuntime({
      chainSeed: [MAINNET_CHAIN],
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();
    await runtime.services.session.createVault({ password: "test" });

    const wallet = createTrustedWalletApiForRuntime(runtime);
    const result = await wallet.session.unlock({ password: "test" });

    expect(result).toMatchObject({
      status: "unlocked",
    });
    runtime.lifecycle.shutdown();
  });

  it("persists selectedNamespace-derived UI chain when wallet.networks.select succeeds", async () => {
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

    const wallet = createTrustedWalletApiForRuntime(runtime);

    expect(walletChainSelectionPort.saved.length).toBe(0);
    await wallet.networks.select({ chainRef: ALT_CHAIN.chainRef });
    await flushAsync();

    expect(walletChainSelectionPort.saved.length).toBeGreaterThan(0);
    await expect(walletChainSelectionPort.get()).resolves.toMatchObject({
      selectedNamespace: ALT_CHAIN.namespace,
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
    });

    runtime.lifecycle.shutdown();
  });

  it("does not change permissions when wallet.networks.select succeeds", async () => {
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

    const wallet = createTrustedWalletApiForRuntime(runtime);

    const before = structuredClone(runtime.services.permissions.getState());
    await wallet.networks.select({ chainRef: ALT_CHAIN.chainRef });

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

    const wallet = createTrustedWalletApiForRuntime(runtime);

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
        source: "provider",
        requestId: "request-1",
      },
    ).settled;

    await flushAsync();

    const before = structuredClone(runtime.services.permissions.getState());
    await expect(
      wallet.approvals.resolve({ approvalId: "switch-chain-approval", action: "approve" }),
    ).resolves.toBeNull();
    await expect(approvalPromise).resolves.toBeNull();
    expect(runtime.services.permissions.getState()).toEqual(before);

    runtime.lifecycle.shutdown();
  });

  it("resolves wallet.balances.getNative via namespace runtime bindings", async () => {
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
    await createActiveAccount(runtime, MAINNET_CHAIN.chainRef);

    expect(runtime.services.namespaceRuntimeSupport.get("eip155")).toMatchObject({
      namespace: "eip155",
      hasRpcClient: true,
      hasSigner: true,
      hasApprovalBindings: true,
      hasUiBindings: true,
      hasTransactionReceiptTracking: true,
    });

    const wallet = createTrustedWalletApiForRuntime(runtime);

    const activeAccount = runtime.services.accounts.getActiveAccountForNamespace({
      namespace: MAINNET_CHAIN.namespace,
      chainRef: MAINNET_CHAIN.chainRef,
    });
    if (!activeAccount) {
      throw new Error("Expected initialized wallet to have an active account");
    }

    await expect(
      wallet.balances.getNative({
        chainRef: MAINNET_CHAIN.chainRef,
        accountKey: activeAccount.accountKey,
      }),
    ).resolves.toEqual({
      accountKey: activeAccount.accountKey,
      chainRef: MAINNET_CHAIN.chainRef,
      amount: "1000000000000000000",
      currency: MAINNET_CHAIN.nativeCurrency,
    });
    expect(getBalance).toHaveBeenCalledWith(activeAccount.canonicalAddress, {
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
        source: "provider",
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
      hasTransactionReceiptTracking: true,
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

    const wallet = createTrustedWalletApiForRuntime(runtime);

    await expect(
      wallet.transactions.requestSendTransactionApproval({
        request: {
          namespace: "eip155",
          payload: {
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x2386f26fc10000",
          },
        },
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
      hasUiBindings: true,
      hasTransactionReceiptTracking: false,
    });
    expect(runtime.services.namespaceBindings.getUi("eip155")).toBeDefined();
    expect(runtime.services.namespaceBindings.hasTransactionReceiptTracking("eip155")).toBe(false);

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
      hasTransactionReceiptTracking: false,
    });

    runtime.lifecycle.shutdown();
  });

  it("creates send-transaction approvals from wallet transaction requests", async () => {
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

    const wallet = createTrustedWalletApiForRuntime(runtime);

    const result = await wallet.transactions.requestSendTransactionApproval({
      request: {
        namespace: "eip155",
        payload: {
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x2386f26fc10000",
        },
      },
    });
    await flushAsync();

    expect(result).toEqual({ approvalId: expect.any(String) });
    await expect(runtime.transactions.listTransactionApprovals()).resolves.toEqual([
      expect.objectContaining({
        approvalId: result.approvalId,
        namespace: "eip155",
        chainRef: MAINNET_CHAIN.chainRef,
        origin: "chrome-extension://arx",
        account: expect.objectContaining({
          address: from,
        }),
        review: expect.objectContaining({
          namespace: "eip155",
        }),
      }),
    ]);

    runtime.lifecycle.shutdown();
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

  it("creates wallet transaction approvals across trusted wallet api instances", async () => {
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

    const firstWallet = createTrustedWalletApiForRuntime(runtime);

    await firstWallet.transactions.requestSendTransactionApproval({
      request: {
        namespace: "eip155",
        payload: {
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x2386f26fc10000",
        },
      },
    });
    await firstWallet.transactions.requestSendTransactionApproval({
      request: {
        namespace: "eip155",
        payload: {
          to: "0xcccccccccccccccccccccccccccccccccccccccc",
          value: "0x470de4df820000",
        },
      },
    });

    const secondWallet = createTrustedWalletApiForRuntime(runtime);

    await secondWallet.transactions.requestSendTransactionApproval({
      request: {
        namespace: "eip155",
        payload: {
          to: "0xdddddddddddddddddddddddddddddddddddddddd",
          value: "0x6a94d74f430000",
        },
      },
    });

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

    const wallet = createTrustedWalletApiForRuntime(runtime);

    await expect(
      wallet.transactions.requestSendTransactionApproval({
        request: {
          namespace: "eip155",
          payload: {
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x2386f26fc10000",
          },
        },
      }),
    ).rejects.toThrow("create approval failed");

    runtime.lifecycle.shutdown();
  });
});
