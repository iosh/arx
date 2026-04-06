import {
  assertValidWalletNamespaceModule,
  createEip155WalletNamespaceModule,
  createNamespaceManifestFromWalletNamespaceModule,
  type WalletNamespaceModule,
} from "@arx/core/engine";
import type { NamespaceManifest } from "@arx/core/namespaces";
import type { Eip6963Info, ProviderModule } from "@arx/provider/modules";
import { createEip155Module } from "@arx/provider/namespaces";

const ARX_EIP6963_PROVIDER_INFO: Eip6963Info = {
  uuid: "90ef60ca-8ea5-4638-b577-6990dc93ef2f",
  name: "ARX Wallet",
  icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgICA8ZGVmcz4KICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImRhcmtTcGFjZSIgeDE9IjAiIHkxPSIwIiB4Mj0iMjAwIiB5Mj0iMjAwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzNBM0EzQSIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwNTA1MDUiLz4KICAgICAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPC9kZWZzPgogICAgPHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIHJ4PSI0NSIgZmlsbD0idXJsKCNkYXJrU3BhY2UpIi8+CiAgICA8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEwMCAzMEw0MCAxNzBINzVMMTAwIDExMEwxMjUgMTcwSDE2MEwxMDAgMzBaTTEwMCA5NUwxMTUgMTM1SDg1TDEwMCA5NVoiIGZpbGw9IiNGRkZGRkYiLz4KPC9zdmc+Cg==",
  rdns: "com.arx.wallet",
};

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
  modules: readonly ProviderModule[];
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
  const providerModules: readonly ProviderModule[] = exposedProviderSpecs.map((spec) => spec.provider.module);

  return {
    specs: validatedSpecs,
    engine: {
      modules: engineModules,
    },
    runtime: {
      manifests,
    },
    provider: {
      modules: providerModules,
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
        module: createEip155Module({
          discovery: {
            eip6963: {
              info: ARX_EIP6963_PROVIDER_INFO,
            },
          },
        }),
      },
    },
  ] as const),
);
