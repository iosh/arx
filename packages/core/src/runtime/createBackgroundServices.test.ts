import { describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainRegistryPort } from "../chains/registryPort.js";
import type { ChainRegistryEntity } from "../storage/index.js";
import {
  flushAsync,
  MemoryAccountsPort,
  MemoryApprovalsPort,
  MemoryChainRegistryPort,
  MemoryKeyringMetasPort,
  MemoryNetworkRpcPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundServices } from "./createBackgroundServices.js";

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

const toRegistryEntity = (metadata: ChainMetadata, now: number): ChainRegistryEntity => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata,
  schemaVersion: 1,
  updatedAt: now,
});

describe("createBackgroundServices (no snapshots)", () => {
  it("hydrates network rpc preferences from NetworkRpcPort", async () => {
    const now = () => 1_000;
    const chainSeed = [MAINNET_CHAIN, ALT_CHAIN];
    const chainRegistryPort: ChainRegistryPort = new MemoryChainRegistryPort(
      chainSeed.map((c) => toRegistryEntity(c, 0)),
    );

    const networkRpcPort = new MemoryNetworkRpcPort([
      {
        chainRef: ALT_CHAIN.chainRef,
        activeIndex: 0,
        strategy: { id: "sticky" },
        updatedAt: now(),
      },
    ]);

    const settingsPort = new MemorySettingsPort({ id: "settings", activeChainRef: ALT_CHAIN.chainRef, updatedAt: 0 });

    const services = createBackgroundServices({
      chainRegistry: { port: chainRegistryPort, seed: chainSeed },
      store: {
        ports: {
          approvals: new MemoryApprovalsPort(),
          permissions: new MemoryPermissionsPort(),
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
        },
      },
      storage: {
        networkRpcPort,
        vaultMetaPort: {
          loadVaultMeta: async () => null,
          saveVaultMeta: async () => {},
          clearVaultMeta: async () => {},
        },
        now,
        networkRpcDebounceMs: 0,
      },
      settings: { port: settingsPort },
    });

    await flushAsync();
    expect(settingsPort.saved.length).toBe(0);
    await expect(settingsPort.get()).resolves.toMatchObject({ activeChainRef: ALT_CHAIN.chainRef });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    const networkState = services.controllers.network.getState();
    expect(networkState.activeChain).toBe(ALT_CHAIN.chainRef);
    expect(networkState.rpc[ALT_CHAIN.chainRef]?.strategy.id).toBe("sticky");

    services.lifecycle.destroy();
  });

  it("persists network rpc preferences only when preferences change", async () => {
    vi.useFakeTimers();

    const now = () => 10_000;
    const chainSeed = [MAINNET_CHAIN];
    const chainRegistryPort: ChainRegistryPort = new MemoryChainRegistryPort(
      chainSeed.map((c) => toRegistryEntity(c, 0)),
    );

    const networkRpcPort = new MemoryNetworkRpcPort();

    const services = createBackgroundServices({
      chainRegistry: { port: chainRegistryPort, seed: chainSeed },
      store: {
        ports: {
          approvals: new MemoryApprovalsPort(),
          permissions: new MemoryPermissionsPort(),
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
        },
      },
      storage: {
        networkRpcPort,
        vaultMetaPort: {
          loadVaultMeta: async () => null,
          saveVaultMeta: async () => {},
          clearVaultMeta: async () => {},
        },
        now,
        networkRpcDebounceMs: 0,
      },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    // Health updates should not persist preferences.
    services.controllers.network.reportRpcOutcome(MAINNET_CHAIN.chainRef, { success: true });
    await flushAsync();
    expect(networkRpcPort.upserts.length).toBe(0);

    // A strategy change is a preference change and should be persisted.
    // NetworkController dedupes state change events using lastUpdatedAt, which is Date.now()-driven.
    // When using fake timers, we must advance time to ensure the state change is published.
    vi.advanceTimersByTime(1);
    services.controllers.network.setStrategy(MAINNET_CHAIN.chainRef, { id: "failover", options: { order: "strict" } });
    await vi.runAllTimersAsync();
    await flushAsync();

    expect(networkRpcPort.upserts.length).toBeGreaterThan(0);
    const last = networkRpcPort.upserts.at(-1);
    expect(last?.chainRef).toBe(MAINNET_CHAIN.chainRef);
    expect(last?.strategy.id).toBe("failover");

    services.lifecycle.destroy();
    vi.useRealTimers();
  });
});
