import { eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
import {
  createBuiltinProviderModules,
  createProviderRegistryFromModules,
  type ProviderModule,
  type ProviderRegistry,
} from "@arx/provider/registry";

export type InstalledNamespaceSpec = Readonly<{
  namespace: string;
  manifest: NamespaceManifest;
  providerModule?: ProviderModule;
}>;

const builtinProviderModules = createBuiltinProviderModules();
const builtinProviderModuleByNamespace = new Map(builtinProviderModules.map((module) => [module.namespace, module]));

const requireBuiltinProviderModule = (namespace: string): ProviderModule => {
  const module = builtinProviderModuleByNamespace.get(namespace);
  if (!module) {
    throw new Error(`Missing builtin provider module for installed namespace "${namespace}"`);
  }
  return module;
};

export const INSTALLED_NAMESPACE_SPECS = [
  {
    namespace: eip155NamespaceManifest.namespace,
    manifest: eip155NamespaceManifest,
    providerModule: requireBuiltinProviderModule(eip155NamespaceManifest.namespace),
  },
] as const satisfies readonly InstalledNamespaceSpec[];

export const INSTALLED_NAMESPACE_MANIFESTS: readonly NamespaceManifest[] = INSTALLED_NAMESPACE_SPECS.map(
  (spec) => spec.manifest,
);

export const INSTALLED_PROVIDER_MODULES: readonly ProviderModule[] = INSTALLED_NAMESPACE_SPECS.flatMap((spec) =>
  spec.providerModule ? [spec.providerModule] : [],
);

export const createInstalledProviderRegistry = (): ProviderRegistry => {
  return createProviderRegistryFromModules(INSTALLED_PROVIDER_MODULES);
};
