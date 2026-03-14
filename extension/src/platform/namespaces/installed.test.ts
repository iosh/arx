import { describe, expect, it } from "vitest";
import type { ProviderModule } from "@arx/provider/registry";
import { eip155NamespaceManifest } from "@arx/core/namespaces";
import {
  createInstalledProviderRegistry,
  defineInstalledNamespaceSpecs,
  INSTALLED_NAMESPACE_MANIFESTS,
  INSTALLED_NAMESPACE_SPECS,
  INSTALLED_PROVIDER_MODULES,
} from "./installed";

describe("installed namespaces composition root", () => {
  it("keeps installed manifests and provider modules aligned by namespace", () => {
    const installedNamespaces = INSTALLED_NAMESPACE_SPECS.map((spec) => spec.namespace);

    expect(installedNamespaces).toEqual(["eip155"]);
    expect(INSTALLED_NAMESPACE_MANIFESTS.map((manifest) => manifest.namespace)).toEqual(installedNamespaces);
    expect(INSTALLED_PROVIDER_MODULES.map((module) => module.namespace)).toEqual(installedNamespaces);
  });

  it("builds provider registries from the installed provider module list", () => {
    const registry = createInstalledProviderRegistry();

    expect(registry.modules.map((module) => module.namespace)).toEqual(
      INSTALLED_PROVIDER_MODULES.map((m) => m.namespace),
    );
    expect([...registry.byNamespace.keys()]).toEqual(INSTALLED_PROVIDER_MODULES.map((module) => module.namespace));
  });

  it("rejects invalid installed namespace specs", () => {
    const mismatchedProviderModule: ProviderModule = {
      namespace: "conflux",
      create: () => {
        throw new Error("not used in test");
      },
    };

    expect(() =>
      defineInstalledNamespaceSpecs([
        { namespace: "eip155", manifest: eip155NamespaceManifest },
        { namespace: "eip155", manifest: eip155NamespaceManifest },
      ] as const),
    ).toThrow(/Duplicate installed namespace "eip155"/);

    expect(() =>
      defineInstalledNamespaceSpecs([
        {
          namespace: "conflux",
          manifest: eip155NamespaceManifest,
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
  });
});
