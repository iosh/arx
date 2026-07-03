import { eip155NamespaceManifest, type NamespaceManifest } from "@arx/core/namespaces";
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
  manifest: NamespaceManifest;
  provider: InstalledNamespaceProviderExposure;
}>;

export type InstalledNamespacesCoreAssembly = Readonly<{
  manifests: readonly NamespaceManifest[];
}>;

export type InstalledNamespacesProviderAssembly = Readonly<{
  modules: readonly ProviderModule[];
}>;

export type InstalledNamespacesComposition = Readonly<{
  specs: readonly InstalledNamespaceSpec[];
  core: InstalledNamespacesCoreAssembly;
  provider: InstalledNamespacesProviderAssembly;
}>;

export const defineInstalledNamespaceSpecs = <const TSpecs extends readonly InstalledNamespaceSpec[]>(
  specs: TSpecs,
): TSpecs => {
  return specs;
};

export const createInstalledNamespacesComposition = (
  specs: readonly InstalledNamespaceSpec[],
): InstalledNamespacesComposition => {
  const validatedSpecs = defineInstalledNamespaceSpecs(specs);
  const manifests: readonly NamespaceManifest[] = validatedSpecs.map((spec) => spec.manifest);
  const exposedProviderSpecs = validatedSpecs.filter(
    (
      spec,
    ): spec is InstalledNamespaceSpec & { provider: Extract<InstalledNamespaceProviderExposure, { expose: true }> } =>
      spec.provider.expose,
  );
  const providerModules: readonly ProviderModule[] = exposedProviderSpecs.map((spec) => spec.provider.module);

  return {
    specs: validatedSpecs,
    core: {
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
      manifest: eip155NamespaceManifest,
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
