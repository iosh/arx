import { describe, expect, it } from "vitest";
import { toAccountIdFromAddress } from "../accounts/addressing/accountId.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { ApprovalKinds } from "../controllers/index.js";
import type { ChainDefinitionsPort } from "../services/store/chainDefinitions/port.js";
import type { ChainDefinitionEntity } from "../storage/index.js";
import { createUiHandlers } from "../ui/server/index.js";
import {
  flushAsync,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
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

const toRegistryEntity = (metadata: ChainMetadata, now: number): ChainDefinitionEntity => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata,
  schemaVersion: 2,
  updatedAt: now,
  source: "builtin",
});

describe("createBackgroundRuntime (no snapshots)", () => {
  it("hydrates network preferences from NetworkPreferencesPort", async () => {
    const now = () => 1_000;
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const chainDefinitionsPort: ChainDefinitionsPort = new MemoryChainDefinitionsPort(
      chainSeed.map((c) => toRegistryEntity(c, 0)),
    );

    const networkPreferencesPort = new MemoryNetworkPreferencesPort({
      id: "network-preferences",
      selectedChainRef: ALT_CHAIN.chainRef,
      activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "sticky" } },
      },
      updatedAt: now(),
    });

    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: chainDefinitionsPort, seed: chainSeed },
      rpcEngine: {
        env: {
          isInternalOrigin: () => false,
          shouldRequestUnlockAttention: () => false,
        },
      },
      networkPreferences: { port: networkPreferencesPort },
      store: {
        ports: {
          permissions: new MemoryPermissionsPort(),
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
        },
      },
      storage: {
        vaultMetaPort: {
          loadVaultMeta: async () => null,
          saveVaultMeta: async () => {},
          clearVaultMeta: async () => {},
        },
        now,
      },
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    });

    await flushAsync();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const networkState = runtime.controllers.network.getState();
    expect(runtime.services.networkPreferences.getSelectedChainRef()).toBe(ALT_CHAIN.chainRef);
    expect(runtime.services.chainViews.getSelectedChainView().chainRef).toBe(ALT_CHAIN.chainRef);
    expect(networkState.availableChainRefs).toEqual([MAINNET_CHAIN.chainRef, ALT_CHAIN.chainRef]);
    expect(networkState.rpc[ALT_CHAIN.chainRef]?.strategy.id).toBe("sticky");

    runtime.lifecycle.destroy();
  });

  it("persists selectedChainRef when ui.networks.switchActive succeeds", async () => {
    const now = () => 10_000;
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const chainDefinitionsPort: ChainDefinitionsPort = new MemoryChainDefinitionsPort(
      chainSeed.map((c) => toRegistryEntity(c, 0)),
    );

    const networkPreferencesPort = new MemoryNetworkPreferencesPort({
      id: "network-preferences",
      selectedChainRef: MAINNET_CHAIN.chainRef,
      activeChainByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      rpc: {},
      updatedAt: 0,
    });

    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: chainDefinitionsPort, seed: chainSeed },
      rpcEngine: {
        env: {
          isInternalOrigin: () => false,
          shouldRequestUnlockAttention: () => false,
        },
      },
      networkPreferences: { port: networkPreferencesPort },
      store: {
        ports: {
          permissions: new MemoryPermissionsPort(),
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
        },
      },
      storage: {
        vaultMetaPort: {
          loadVaultMeta: async () => null,
          saveVaultMeta: async () => {},
          clearVaultMeta: async () => {},
        },
        now,
      },
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const handlers = createUiHandlers({
      controllers: runtime.controllers,
      chainActivation: runtime.services.chainActivation,
      chainViews: runtime.services.chainViews,
      permissionViews: runtime.services.permissionViews,
      session: runtime.services.session,
      keyring: runtime.services.keyring,
      attention: runtime.services.attention,
      rpcClients: runtime.rpc.clients,
      rpcRegistry: runtime.rpc.registry,
      uiOrigin: "chrome-extension://arx",
      platform: {
        openOnboardingTab: async () => ({ activationPath: "create" }),
        openNotificationPopup: async () => ({ activationPath: "create" }),
      },
    });

    expect(networkPreferencesPort.saved.length).toBe(0);
    await handlers["ui.networks.switchActive"]({ chainRef: ALT_CHAIN.chainRef });
    await flushAsync();

    expect(networkPreferencesPort.saved.length).toBeGreaterThan(0);
    await expect(networkPreferencesPort.get()).resolves.toMatchObject({
      selectedChainRef: ALT_CHAIN.chainRef,
      activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
    });

    runtime.lifecycle.destroy();
  });

  it("does not change permissions when ui.networks.switchActive succeeds", async () => {
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const chainDefinitionsPort: ChainDefinitionsPort = new MemoryChainDefinitionsPort(
      chainSeed.map((c) => toRegistryEntity(c, 0)),
    );

    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: chainDefinitionsPort, seed: chainSeed },
      rpcEngine: {
        env: {
          isInternalOrigin: () => false,
          shouldRequestUnlockAttention: () => false,
        },
      },
      networkPreferences: { port: new MemoryNetworkPreferencesPort() },
      store: {
        ports: {
          permissions: new MemoryPermissionsPort(),
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
        },
      },
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.controllers.permissions.upsertAuthorization("https://dapp.example", {
      namespace: MAINNET_CHAIN.namespace,
      chains: [
        {
          chainRef: MAINNET_CHAIN.chainRef,
          accountIds: [
            toAccountIdFromAddress({
              chainRef: MAINNET_CHAIN.chainRef,
              address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            }),
          ],
        },
      ],
    });

    const handlers = createUiHandlers({
      controllers: runtime.controllers,
      chainActivation: runtime.services.chainActivation,
      chainViews: runtime.services.chainViews,
      permissionViews: runtime.services.permissionViews,
      session: runtime.services.session,
      keyring: runtime.services.keyring,
      attention: runtime.services.attention,
      rpcClients: runtime.rpc.clients,
      rpcRegistry: runtime.rpc.registry,
      uiOrigin: "chrome-extension://arx",
      platform: {
        openOnboardingTab: async () => ({ activationPath: "create" }),
        openNotificationPopup: async () => ({ activationPath: "create" }),
      },
    });

    const before = structuredClone(runtime.controllers.permissions.getState());
    await handlers["ui.networks.switchActive"]({ chainRef: ALT_CHAIN.chainRef });

    expect(runtime.controllers.permissions.getState()).toEqual(before);

    runtime.lifecycle.destroy();
  });

  it("does not change permissions when switch-chain approval is approved", async () => {
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const chainDefinitionsPort: ChainDefinitionsPort = new MemoryChainDefinitionsPort(
      chainSeed.map((c) => toRegistryEntity(c, 0)),
    );

    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: chainDefinitionsPort, seed: chainSeed },
      rpcEngine: {
        env: {
          isInternalOrigin: () => false,
          shouldRequestUnlockAttention: () => false,
        },
      },
      networkPreferences: { port: new MemoryNetworkPreferencesPort() },
      store: {
        ports: {
          permissions: new MemoryPermissionsPort(),
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
        },
      },
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.controllers.permissions.upsertAuthorization("https://dapp.example", {
      namespace: MAINNET_CHAIN.namespace,
      chains: [
        {
          chainRef: MAINNET_CHAIN.chainRef,
          accountIds: [
            toAccountIdFromAddress({
              chainRef: MAINNET_CHAIN.chainRef,
              address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            }),
          ],
        },
      ],
    });

    const handlers = createUiHandlers({
      controllers: runtime.controllers,
      chainActivation: runtime.services.chainActivation,
      chainViews: runtime.services.chainViews,
      permissionViews: runtime.services.permissionViews,
      session: runtime.services.session,
      keyring: runtime.services.keyring,
      attention: runtime.services.attention,
      rpcClients: runtime.rpc.clients,
      rpcRegistry: runtime.rpc.registry,
      uiOrigin: "chrome-extension://arx",
      platform: {
        openOnboardingTab: async () => ({ activationPath: "create" }),
        openNotificationPopup: async () => ({ activationPath: "create" }),
      },
    });

    const approvalPromise = runtime.controllers.approvals.create(
      {
        id: "switch-chain-approval",
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
      handlers["ui.approvals.resolve"]({ id: "switch-chain-approval", action: "approve" }),
    ).resolves.toMatchObject({
      id: "switch-chain-approval",
      status: "approved",
      result: null,
    });
    await expect(approvalPromise).resolves.toBeNull();
    expect(runtime.controllers.permissions.getState()).toEqual(before);

    runtime.lifecycle.destroy();
  });
});
