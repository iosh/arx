import { eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
import type { ProviderModule } from "@arx/provider/registry";
import { describe, expect, it } from "vitest";
import { createInstalledNamespacesComposition, defineInstalledNamespaceSpecs, INSTALLED_NAMESPACES } from "./installed";

const createTestProviderModule = (namespace: string): ProviderModule => ({
  namespace,
  create: () => {
    throw new Error("not used in test");
  },
});

describe("installed namespaces composition root", () => {
  it("keeps runtime manifests and exposed provider modules aligned by namespace", () => {
    const installedNamespaces = INSTALLED_NAMESPACES.specs.map((spec) => spec.namespace);

    expect(installedNamespaces).toEqual(["eip155"]);
    expect(INSTALLED_NAMESPACES.runtime.manifests.map((manifest) => manifest.namespace)).toEqual(installedNamespaces);
    expect(INSTALLED_NAMESPACES.provider.modules.map((module) => module.namespace)).toEqual(installedNamespaces);
  });

  it("builds provider registries from the provider stage output", () => {
    const registry = INSTALLED_NAMESPACES.provider.createRegistry();

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
    expect(hiddenNamespace.provider.modules).toEqual([]);
    expect(hiddenNamespace.provider.createRegistry().modules).toEqual([]);
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
