import { eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
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

const createManifestForNamespace = (namespace: string): NamespaceManifest => ({
  ...eip155NamespaceManifest,
  namespace,
  core: {
    ...eip155NamespaceManifest.core,
    namespace,
    rpc: {
      ...eip155NamespaceManifest.core.rpc,
      namespace,
      adapter: {
        ...eip155NamespaceManifest.core.rpc.adapter,
        namespace,
      },
    },
    chainAddressCodec: {
      ...eip155NamespaceManifest.core.chainAddressCodec,
      namespace,
    },
    accountCodec: {
      ...eip155NamespaceManifest.core.accountCodec,
      namespace,
    },
    keyring: {
      ...eip155NamespaceManifest.core.keyring,
      namespace,
      defaultChainRef: `${namespace}:1`,
      codec: {
        ...eip155NamespaceManifest.core.keyring.codec,
        namespace,
      },
    },
    chainSeeds: [
      {
        ...eip155NamespaceManifest.core.chainSeeds[0],
        namespace,
        chainRef: `${namespace}:1`,
      },
    ],
  },
});

describe("installed namespaces composition root", () => {
  it("keeps runtime manifests and exposed provider modules aligned by namespace", () => {
    const installedNamespaces = INSTALLED_NAMESPACES.specs.map((spec) => spec.namespace);

    expect(installedNamespaces).toEqual(["eip155"]);
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
          manifest: eip155NamespaceManifest,
          provider: {
            expose: false,
          },
        },
      ] as const),
    );

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
    const invalidManifest: NamespaceManifest = {
      ...eip155NamespaceManifest,
      core: {
        ...eip155NamespaceManifest.core,
        rpc: {
          ...eip155NamespaceManifest.core.rpc,
          namespace: "conflux",
        },
      },
    };

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          manifest: eip155NamespaceManifest,
          provider: {
            expose: true,
            module: createTestProviderModule("eip155"),
          },
        },
        {
          namespace: "eip155",
          manifest: eip155NamespaceManifest,
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
          manifest: eip155NamespaceManifest,
          provider: {
            expose: true,
            module: createTestProviderModule("conflux"),
          },
        },
      ] as const),
    ).toThrow(/must use a manifest with the same namespace/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          manifest: eip155NamespaceManifest,
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
          manifest: eip155NamespaceManifest,
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
          manifest: createManifestForNamespace("conflux"),
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
          manifest: eip155NamespaceManifest,
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
          manifest: createManifestForNamespace("conflux"),
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
          manifest: invalidManifest,
          provider: {
            expose: true,
            module: createTestProviderModule("eip155"),
          },
        },
      ] as const),
    ).toThrow(/core\.rpc\.namespace/);
  });
});
