import { describe, expect, it } from "vitest";
import {
  flushAsync,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
  toRegistryEntity,
} from "../runtime/__fixtures__/backgroundTestSetup.js";
import { createArxWallet } from "./createArxWallet.js";
import { createEip155WalletNamespaceModule } from "./modules/eip155.js";
import type { CreateArxWalletInput, WalletNamespaceModule } from "./types.js";

const createWalletInput = (params?: {
  modules?: readonly WalletNamespaceModule[];
  networkPreferencesPort?: MemoryNetworkPreferencesPort;
}): CreateArxWalletInput => {
  const modules = params?.modules ?? [createEip155WalletNamespaceModule()];
  const chainSeeds = modules.flatMap((module) => module.engine.facts.chainSeeds ?? []);

  return {
    namespaces: {
      modules,
    },
    storage: {
      ports: {
        accounts: new MemoryAccountsPort(),
        chainDefinitions: new MemoryChainDefinitionsPort(
          chainSeeds.map((chain, index) => toRegistryEntity(chain, index)),
        ),
        keyringMetas: new MemoryKeyringMetasPort(),
        networkPreferences: params?.networkPreferencesPort ?? new MemoryNetworkPreferencesPort(),
        permissions: new MemoryPermissionsPort(),
        settings: new MemorySettingsPort({ id: "settings", updatedAt: 0 }),
        transactions: new MemoryTransactionsPort(),
      },
    },
  };
};

describe("createArxWallet", () => {
  it("boots an eip155 wallet and returns ready namespaces", async () => {
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

    const wallet = await createArxWallet(createWalletInput({ networkPreferencesPort }));
    await flushAsync();
    const eip155Module = wallet.namespaces.requireModule("eip155");

    expect(wallet.namespaces.listNamespaces()).toEqual(["eip155"]);
    expect(eip155Module.namespace).toBe("eip155");
    expect(eip155Module.engine.facts.chainSeeds?.length).toBeGreaterThan(0);
    expect(eip155Module.engine.factories?.createSigner).toBeTypeOf("function");

    const correctedPreferences = networkPreferencesPort.saved.at(-1);
    expect(correctedPreferences).toMatchObject({
      selectedNamespace: "eip155",
    });
    expect(correctedPreferences?.activeChainByNamespace.eip155).toBeDefined();

    await wallet.destroy();
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

  it("rejects invalid module facts during boot", async () => {
    const module = createEip155WalletNamespaceModule();
    const invalidModule: WalletNamespaceModule = {
      ...module,
      engine: {
        ...module.engine,
        facts: {
          ...module.engine.facts,
          rpc: {
            ...module.engine.facts.rpc,
            namespace: "conflux",
          },
        },
      },
    };

    await expect(createArxWallet(createWalletInput({ modules: [invalidModule] }))).rejects.toThrow(
      /core\.rpc\.namespace/,
    );
  });

  it("cleans up registry access after destroy and keeps destroy idempotent", async () => {
    const wallet = await createArxWallet(createWalletInput());

    await wallet.destroy();
    await wallet.destroy();

    expect(() => wallet.namespaces.listNamespaces()).toThrow(/ArxWallet is destroyed/);
    expect(() => wallet.namespaces.requireModule("eip155")).toThrow(/ArxWallet is destroyed/);
  });
});
