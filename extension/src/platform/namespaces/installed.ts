import {
  assertValidWalletNamespaceModule,
  createEip155WalletNamespaceModule,
  createNamespaceManifestFromWalletNamespaceModule,
  type WalletNamespaceModule,
} from "@arx/core/engine";
import type { NamespaceManifest } from "@arx/core/namespaces";
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
  module: WalletNamespaceModule;
  provider: InstalledNamespaceProviderExposure;
}>;

export type InstalledNamespacesEngineAssembly = Readonly<{
  modules: readonly WalletNamespaceModule[];
}>;

export type InstalledNamespacesRuntimeAssembly = Readonly<{
  manifests: readonly NamespaceManifest[];
}>;

export type InstalledNamespacesProviderAssembly = Readonly<{
  exposedNamespaces: readonly string[];
  modules: readonly ProviderModule[];
  registry: ProviderRegistry;
}>;

export type InstalledNamespacesComposition = Readonly<{
  specs: readonly InstalledNamespaceSpec[];
  engine: InstalledNamespacesEngineAssembly;
  runtime: InstalledNamespacesRuntimeAssembly;
  provider: InstalledNamespacesProviderAssembly;
}>;

export const defineInstalledNamespaceSpecs = <const TSpecs extends readonly InstalledNamespaceSpec[]>(
  specs: TSpecs,
): TSpecs => {
  const seen = new Set<string>();
  const exposedWindowKeyOwnerByKey = new Map<string, string>();
  const exposedInitializedEventOwnerByName = new Map<string, string>();

  for (const spec of specs) {
    assertValidWalletNamespaceModule(spec.module);

    if (seen.has(spec.namespace)) {
      throw new Error(`Duplicate installed namespace "${spec.namespace}"`);
    }
    seen.add(spec.namespace);

    if (spec.module.namespace !== spec.namespace) {
      throw new Error(
        `Installed namespace "${spec.namespace}" must use a wallet namespace module with the same namespace; received "${spec.module.namespace}"`,
      );
    }

    if (spec.provider.expose && spec.provider.module.namespace !== spec.namespace) {
      throw new Error(
        `Installed namespace "${spec.namespace}" must use a provider module with the same namespace; received "${spec.provider.module.namespace}"`,
      );
    }

    if (!spec.provider.expose) {
      continue;
    }

    const injection = spec.provider.module.injection;
    if (!injection) {
      continue;
    }

    const existingWindowKeyOwner = exposedWindowKeyOwnerByKey.get(injection.windowKey);
    if (existingWindowKeyOwner) {
      throw new Error(
        `Exposed provider modules for "${existingWindowKeyOwner}" and "${spec.namespace}" cannot share injection.windowKey "${injection.windowKey}"`,
      );
    }
    exposedWindowKeyOwnerByKey.set(injection.windowKey, spec.namespace);

    if (!injection.initializedEvent) {
      continue;
    }

    const existingInitializedEventOwner = exposedInitializedEventOwnerByName.get(injection.initializedEvent);
    if (existingInitializedEventOwner) {
      throw new Error(
        `Exposed provider modules for "${existingInitializedEventOwner}" and "${spec.namespace}" cannot share injection.initializedEvent "${injection.initializedEvent}"`,
      );
    }
    exposedInitializedEventOwnerByName.set(injection.initializedEvent, spec.namespace);
  }

  return specs;
};

export const createInstalledNamespacesComposition = (
  specs: readonly InstalledNamespaceSpec[],
): InstalledNamespacesComposition => {
  const validatedSpecs = defineInstalledNamespaceSpecs(specs);
  const engineModules: readonly WalletNamespaceModule[] = validatedSpecs.map((spec) => spec.module);
  const manifests: readonly NamespaceManifest[] = engineModules.map((module) =>
    createNamespaceManifestFromWalletNamespaceModule(module),
  );
  const exposedProviderSpecs = validatedSpecs.filter(
    (
      spec,
    ): spec is InstalledNamespaceSpec & { provider: Extract<InstalledNamespaceProviderExposure, { expose: true }> } =>
      spec.provider.expose,
  );
  const exposedNamespaces: readonly string[] = exposedProviderSpecs.map((spec) => spec.namespace);
  const providerModules: readonly ProviderModule[] = exposedProviderSpecs.map((spec) => spec.provider.module);
  const providerRegistry = createProviderRegistryFromModules(providerModules);

  return {
    specs: validatedSpecs,
    engine: {
      modules: engineModules,
    },
    runtime: {
      manifests,
    },
    provider: {
      exposedNamespaces,
      modules: providerModules,
      registry: providerRegistry,
    },
  };
};

export const INSTALLED_NAMESPACES = createInstalledNamespacesComposition(
  defineInstalledNamespaceSpecs([
    {
      namespace: "eip155",
      module: createEip155WalletNamespaceModule(),
      provider: {
        expose: true,
        module: createEip155Module(),
      },
    },
  ] as const),
);
