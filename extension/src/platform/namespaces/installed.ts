import { assertValidNamespaceManifest, eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
import { createEip155Module } from "@arx/provider/namespaces";
import { createProviderRegistryFromModules, type ProviderModule, type ProviderRegistry } from "@arx/provider/registry";

export type InstalledNamespaceSpec = Readonly<{
  namespace: string;
  manifest: NamespaceManifest;
  providerModule: ProviderModule;
}>;

export type InstalledNamespacesComposition = Readonly<{
  specs: readonly InstalledNamespaceSpec[];
  manifests: readonly NamespaceManifest[];
  providerModules: readonly ProviderModule[];
  createProviderRegistry: () => ProviderRegistry;
}>;

export const defineInstalledNamespaceSpecs = <const TSpecs extends readonly InstalledNamespaceSpec[]>(
  specs: TSpecs,
): TSpecs => {
  const seen = new Set<string>();

  for (const spec of specs) {
    assertValidNamespaceManifest(spec.manifest);

    if (seen.has(spec.namespace)) {
      throw new Error(`Duplicate installed namespace "${spec.namespace}"`);
    }
    seen.add(spec.namespace);

    if (spec.manifest.namespace !== spec.namespace) {
      throw new Error(
        `Installed namespace "${spec.namespace}" must use a manifest with the same namespace; received "${spec.manifest.namespace}"`,
      );
    }

    if (spec.providerModule.namespace !== spec.namespace) {
      throw new Error(
        `Installed namespace "${spec.namespace}" must use a provider module with the same namespace; received "${spec.providerModule.namespace}"`,
      );
    }
  }

  return specs;
};

export const createInstalledNamespacesComposition = (
  specs: readonly InstalledNamespaceSpec[],
): InstalledNamespacesComposition => {
  const validatedSpecs = defineInstalledNamespaceSpecs(specs);
  const manifests: readonly NamespaceManifest[] = validatedSpecs.map((spec) => spec.manifest);
  const providerModules: readonly ProviderModule[] = validatedSpecs.map((spec) => spec.providerModule);

  return {
    specs: validatedSpecs,
    manifests,
    providerModules,
    createProviderRegistry: () => createProviderRegistryFromModules(providerModules),
  };
};

export const INSTALLED_NAMESPACES = createInstalledNamespacesComposition(
  defineInstalledNamespaceSpecs([
    {
      namespace: eip155NamespaceManifest.namespace,
      manifest: eip155NamespaceManifest,
      providerModule: createEip155Module(),
    },
  ] as const),
);

export const INSTALLED_NAMESPACE_SPECS: readonly InstalledNamespaceSpec[] = INSTALLED_NAMESPACES.specs;

export const INSTALLED_NAMESPACE_MANIFESTS: readonly NamespaceManifest[] = INSTALLED_NAMESPACES.manifests;

export const INSTALLED_PROVIDER_MODULES: readonly ProviderModule[] = INSTALLED_NAMESPACES.providerModules;

export const createInstalledProviderRegistry = (): ProviderRegistry => {
  return INSTALLED_NAMESPACES.createProviderRegistry();
};
