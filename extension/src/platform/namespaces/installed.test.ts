import { describe, expect, it } from "vitest";
import {
  createInstalledProviderRegistry,
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
});
