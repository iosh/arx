import { assertValidNamespaceManifest, eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
import { createEip155Module } from "@arx/provider/namespaces";
import { createProviderRegistryFromModules, type ProviderModule, type ProviderRegistry } from "@arx/provider/registry";

export type InstalledNamespaceProviderExposure =
  | Readonly<{
      expose: false;
    }>
  | Readonly<{
      expose: true;
      module: ProviderModule;
    }>;

export type InstalledNamespaceSpec = Readonly<{
  namespace: string;
  manifest: NamespaceManifest;
  provider: InstalledNamespaceProviderExposure;
}>;

export type InstalledNamespacesRuntimeAssembly = Readonly<{
  manifests: readonly NamespaceManifest[];
}>;

export type InstalledNamespacesProviderAssembly = Readonly<{
  modules: readonly ProviderModule[];
  createRegistry: () => ProviderRegistry;
}>;

export type InstalledNamespacesComposition = Readonly<{
  specs: readonly InstalledNamespaceSpec[];
  runtime: InstalledNamespacesRuntimeAssembly;
  provider: InstalledNamespacesProviderAssembly;
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

    if (spec.provider.expose && spec.provider.module.namespace !== spec.namespace) {
      throw new Error(
        `Installed namespace "${spec.namespace}" must use a provider module with the same namespace; received "${spec.provider.module.namespace}"`,
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
  const providerModules: readonly ProviderModule[] = validatedSpecs.flatMap((spec) =>
    spec.provider.expose ? [spec.provider.module] : [],
  );

  return {
    specs: validatedSpecs,
    runtime: {
      manifests,
    },
    provider: {
      modules: providerModules,
      createRegistry: () => createProviderRegistryFromModules(providerModules),
    },
  };
};

export const INSTALLED_NAMESPACES = createInstalledNamespacesComposition(
  defineInstalledNamespaceSpecs([
    {
      namespace: eip155NamespaceManifest.namespace,
      manifest: eip155NamespaceManifest,
      provider: {
        expose: true,
        module: createEip155Module(),
      },
    },
  ] as const),
);
