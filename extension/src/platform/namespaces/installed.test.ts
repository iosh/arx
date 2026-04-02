import { createEip155WalletNamespaceModule, type WalletNamespaceModule } from "@arx/core/engine";
import type { ProviderModule } from "@arx/provider/registry";
import { describe, expect, it } from "vitest";
import { createInstalledNamespacesComposition, defineInstalledNamespaceSpecs, INSTALLED_NAMESPACES } from "./installed";

const createTestProviderModule = (
  namespace: string,
  options?: {
    injection?: ProviderModule["injection"];
  },
): ProviderModule => ({
  namespace,
  create: () => {
    throw new Error("not used in test");
  },
  ...(options?.injection ? { injection: options.injection } : {}),
});

const createWalletModuleForNamespace = (namespace: string): WalletNamespaceModule => {
  const module = createEip155WalletNamespaceModule();

  return {
    ...module,
    namespace,
    engine: {
      ...module.engine,
      facts: {
        ...module.engine.facts,
        namespace,
        rpc: {
          ...module.engine.facts.rpc,
          namespace,
          adapter: {
            ...module.engine.facts.rpc.adapter,
            namespace,
          },
        },
        chainAddressCodec: {
          ...module.engine.facts.chainAddressCodec,
          namespace,
        },
        accountCodec: {
          ...module.engine.facts.accountCodec,
          namespace,
        },
        keyring: {
          ...module.engine.facts.keyring,
          namespace,
          defaultChainRef: `${namespace}:1`,
          codec: {
            ...module.engine.facts.keyring.codec,
            namespace,
          },
        },
        chainSeeds: module.engine.facts.chainSeeds?.map((chain) => ({
          ...chain,
          namespace,
          chainRef: `${namespace}:1`,
        })),
      },
    },
  };
};

describe("installed namespaces composition root", () => {
  it("keeps engine modules, compat runtime manifests, and exposed provider modules aligned by namespace", () => {
    const installedNamespaces = INSTALLED_NAMESPACES.specs.map((spec) => spec.namespace);

    expect(installedNamespaces).toEqual(["eip155"]);
    expect(INSTALLED_NAMESPACES.engine.modules.map((module) => module.namespace)).toEqual(installedNamespaces);
    expect(INSTALLED_NAMESPACES.runtime.manifests.map((manifest) => manifest.namespace)).toEqual(installedNamespaces);
    expect(INSTALLED_NAMESPACES.provider.exposedNamespaces).toEqual(installedNamespaces);
    expect(INSTALLED_NAMESPACES.provider.modules.map((module) => module.namespace)).toEqual(installedNamespaces);
  });

  it("builds provider registries from the provider stage output", () => {
    const registry = INSTALLED_NAMESPACES.provider.registry;

    expect(registry.modules).toBe(INSTALLED_NAMESPACES.provider.modules);
    expect(registry.modules.map((module) => module.namespace)).toEqual(["eip155"]);
    expect([...registry.byNamespace.keys()]).toEqual(["eip155"]);
  });

  it("supports installed namespaces that are not exposed to dapps", () => {
    const hiddenNamespace = createInstalledNamespacesComposition(
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          module: createEip155WalletNamespaceModule(),
          provider: {
            expose: false,
          },
        },
      ] as const),
    );

    expect(hiddenNamespace.engine.modules.map((module) => module.namespace)).toEqual(["eip155"]);
    expect(hiddenNamespace.runtime.manifests.map((manifest) => manifest.namespace)).toEqual(["eip155"]);
    expect(hiddenNamespace.provider.exposedNamespaces).toEqual([]);
    expect(hiddenNamespace.provider.modules).toEqual([]);
    expect(hiddenNamespace.provider.registry.modules).toEqual([]);
    expect([...hiddenNamespace.provider.registry.byNamespace.keys()]).toEqual([]);
  });

  it("rejects invalid installed namespace specs", () => {
    const mismatchedProviderModule: ProviderModule = {
      namespace: "conflux",
      create: () => {
        throw new Error("not used in test");
      },
    };
    const invalidModule: WalletNamespaceModule = {
      ...createEip155WalletNamespaceModule(),
      engine: {
        ...createEip155WalletNamespaceModule().engine,
        facts: {
          ...createEip155WalletNamespaceModule().engine.facts,
          rpc: {
            ...createEip155WalletNamespaceModule().engine.facts.rpc,
            namespace: "conflux",
          },
        },
      },
    };

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          module: createEip155WalletNamespaceModule(),
          provider: {
            expose: true,
            module: createTestProviderModule("eip155"),
          },
        },
        {
          namespace: "eip155",
          module: createEip155WalletNamespaceModule(),
          provider: {
            expose: true,
            module: createTestProviderModule("eip155"),
          },
        },
      ] as const),
    ).toThrow(/Duplicate installed namespace "eip155"/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "conflux",
          module: createEip155WalletNamespaceModule(),
          provider: {
            expose: true,
            module: createTestProviderModule("conflux"),
          },
        },
      ] as const),
    ).toThrow(/must use a wallet namespace module with the same namespace/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          module: createEip155WalletNamespaceModule(),
          provider: {
            expose: true,
            module: mismatchedProviderModule,
          },
        },
      ] as const),
    ).toThrow(/must use a provider module with the same namespace/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          module: createEip155WalletNamespaceModule(),
          provider: {
            expose: true,
            module: createTestProviderModule("eip155", {
              injection: {
                windowKey: "ethereum",
                initializedEvent: "ethereum#initialized",
              },
            }),
          },
        },
        {
          namespace: "conflux",
          module: createWalletModuleForNamespace("conflux"),
          provider: {
            expose: true,
            module: createTestProviderModule("conflux", {
              injection: {
                windowKey: "ethereum",
                initializedEvent: "conflux#initialized",
              },
            }),
          },
        },
      ] as const),
    ).toThrow(/cannot share injection\.windowKey "ethereum"/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          module: createEip155WalletNamespaceModule(),
          provider: {
            expose: true,
            module: createTestProviderModule("eip155", {
              injection: {
                windowKey: "ethereum",
                initializedEvent: "wallet#initialized",
              },
            }),
          },
        },
        {
          namespace: "conflux",
          module: createWalletModuleForNamespace("conflux"),
          provider: {
            expose: true,
            module: createTestProviderModule("conflux", {
              injection: {
                windowKey: "conflux",
                initializedEvent: "wallet#initialized",
              },
            }),
          },
        },
      ] as const),
    ).toThrow(/cannot share injection\.initializedEvent "wallet#initialized"/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          module: invalidModule,
          provider: {
            expose: true,
            module: createTestProviderModule("eip155"),
          },
        },
      ] as const),
    ).toThrow(/core\.rpc\.namespace/);
  });
});
