import { eip155NamespaceManifest } from "@arx/core/namespaces";
import { describe, expect, it } from "vitest";
import { createInstalledNamespacesComposition, defineInstalledNamespaceSpecs, INSTALLED_NAMESPACES } from "./installed";

describe("installed namespaces composition root", () => {
  it("keeps core manifests and exposed provider modules aligned by namespace", () => {
    const installedNamespaces = INSTALLED_NAMESPACES.specs.map((spec) => spec.namespace);

    expect(installedNamespaces).toEqual(["eip155"]);
    expect(INSTALLED_NAMESPACES.core.manifests.map((manifest) => manifest.namespace)).toEqual(installedNamespaces);
    expect(INSTALLED_NAMESPACES.provider.modules.map((module) => module.namespace)).toEqual(installedNamespaces);
  });

  it("keeps exposed provider modules stable in the provider stage output", () => {
    expect(INSTALLED_NAMESPACES.provider.modules.map((module) => module.namespace)).toEqual(["eip155"]);
    expect(INSTALLED_NAMESPACES.provider.modules[0]?.discovery?.eip6963?.info).toMatchObject({
      name: "ARX Wallet",
      rdns: "com.arx.wallet",
    });
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

    expect(hiddenNamespace.core.manifests.map((manifest) => manifest.namespace)).toEqual(["eip155"]);
    expect(hiddenNamespace.provider.modules).toEqual([]);
  });
});
