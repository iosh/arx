import { eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
import type { ProviderModule } from "@arx/provider/registry";
import { describe, expect, it } from "vitest";
import {
  createInstalledProviderRegistry,
  defineInstalledNamespaceSpecs,
  INSTALLED_NAMESPACE_MANIFESTS,
  INSTALLED_NAMESPACE_SPECS,
  INSTALLED_NAMESPACES,
  INSTALLED_PROVIDER_MODULES,
} from "./installed";

const createTestProviderModule = (namespace: string): ProviderModule => ({
  namespace,
  create: () => {
    throw new Error("not used in test");
  },
});

describe("installed namespaces composition root", () => {
  it("keeps installed manifests and provider modules aligned by namespace", () => {
    const installedNamespaces = INSTALLED_NAMESPACE_SPECS.map((spec) => spec.namespace);

    expect(INSTALLED_NAMESPACES.specs).toBe(INSTALLED_NAMESPACE_SPECS);
    expect(INSTALLED_NAMESPACES.manifests).toBe(INSTALLED_NAMESPACE_MANIFESTS);
    expect(INSTALLED_NAMESPACES.providerModules).toBe(INSTALLED_PROVIDER_MODULES);
    expect(installedNamespaces).toEqual(["eip155"]);
    expect(INSTALLED_NAMESPACE_MANIFESTS.map((manifest) => manifest.namespace)).toEqual(installedNamespaces);
    expect(INSTALLED_PROVIDER_MODULES.map((module) => module.namespace)).toEqual(installedNamespaces);
  });

  it("builds provider registries from the installed provider module list", () => {
    const registry = createInstalledProviderRegistry();
    const compositionRegistry = INSTALLED_NAMESPACES.createProviderRegistry();

    expect(registry.modules.map((module) => module.namespace)).toEqual(
      INSTALLED_PROVIDER_MODULES.map((m) => m.namespace),
    );
    expect([...registry.byNamespace.keys()]).toEqual(INSTALLED_PROVIDER_MODULES.map((module) => module.namespace));
    expect(compositionRegistry.modules).toBe(INSTALLED_PROVIDER_MODULES);
    expect([...compositionRegistry.byNamespace.keys()]).toEqual(
      INSTALLED_PROVIDER_MODULES.map((module) => module.namespace),
    );
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
          providerModule: createTestProviderModule("eip155"),
        },
        {
          namespace: "eip155",
          manifest: eip155NamespaceManifest,
          providerModule: createTestProviderModule("eip155"),
        },
      ] as const),
    ).toThrow(/Duplicate installed namespace "eip155"/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "conflux",
          manifest: eip155NamespaceManifest,
          providerModule: createTestProviderModule("conflux"),
        },
      ] as const),
    ).toThrow(/must use a manifest with the same namespace/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          manifest: eip155NamespaceManifest,
          providerModule: mismatchedProviderModule,
        },
      ] as const),
    ).toThrow(/must use a provider module with the same namespace/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "eip155",
          manifest: invalidManifest,
          providerModule: createTestProviderModule("eip155"),
        },
      ] as const),
    ).toThrow(/core\.rpc\.namespace/);
  });
});
