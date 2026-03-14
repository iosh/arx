import { eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
import { createEip155Module } from "@arx/provider/namespaces";
import { createProviderRegistryFromModules, type ProviderModule, type ProviderRegistry } from "@arx/provider/registry";

export type InstalledNamespaceSpec = Readonly<{
  namespace: string;
  manifest: NamespaceManifest;
  providerModule?: ProviderModule;
}>;

export const defineInstalledNamespaceSpecs = <const TSpecs extends readonly InstalledNamespaceSpec[]>(
  specs: TSpecs,
): TSpecs => {
  const seen = new Set<string>();

  for (const spec of specs) {
    if (seen.has(spec.namespace)) {
      throw new Error(`Duplicate installed namespace "${spec.namespace}"`);
    }
    seen.add(spec.namespace);

    if (spec.manifest.namespace !== spec.namespace) {
      throw new Error(
        `Installed namespace "${spec.namespace}" must use a manifest with the same namespace; received "${spec.manifest.namespace}"`,
      );
    }

    if (spec.providerModule && spec.providerModule.namespace !== spec.namespace) {
      throw new Error(
        `Installed namespace "${spec.namespace}" must use a provider module with the same namespace; received "${spec.providerModule.namespace}"`,
      );
    }
  }

  return specs;
};

export const INSTALLED_NAMESPACE_SPECS = defineInstalledNamespaceSpecs([
  {
    namespace: eip155NamespaceManifest.namespace,
    manifest: eip155NamespaceManifest,
    providerModule: createEip155Module(),
  },
] as const);

export const INSTALLED_NAMESPACE_MANIFESTS: readonly NamespaceManifest[] = INSTALLED_NAMESPACE_SPECS.map(
  (spec) => spec.manifest,
);

export const INSTALLED_PROVIDER_MODULES: readonly ProviderModule[] = INSTALLED_NAMESPACE_SPECS.flatMap((spec) =>
  spec.providerModule ? [spec.providerModule] : [],
);

export const createInstalledProviderRegistry = (): ProviderRegistry => {
  return createProviderRegistryFromModules(INSTALLED_PROVIDER_MODULES);
};
