import type { ProviderModule } from "../registry/types.js";
import { createEip155Module } from "./eip155/module.js";

type BuiltinProviderModuleFactory<TNamespace extends string = string, TOptions = never> = Readonly<{
  namespace: TNamespace;
  create: (options?: TOptions) => ProviderModule;
}>;

// Compatibility helper for callers without a platform composition root.
// Real platforms should decide which provider modules are installed and pass them explicitly.
export const BUILTIN_PROVIDER_MODULE_FACTORIES = [
  {
    namespace: "eip155",
    create: createEip155Module,
  },
] as const satisfies readonly BuiltinProviderModuleFactory[];

type BuiltinProviderModuleFactories = typeof BUILTIN_PROVIDER_MODULE_FACTORIES;

export type BuiltinProviderModulesOptions = {
  [Factory in BuiltinProviderModuleFactories[number] as Factory["namespace"]]?: Parameters<Factory["create"]>[0];
};

const createBuiltinProviderModule = <Factory extends BuiltinProviderModuleFactories[number]>(
  factory: Factory,
  options: BuiltinProviderModulesOptions,
): ProviderModule => {
  return factory.create(options[factory.namespace] as Parameters<Factory["create"]>[0]);
};

export const createBuiltinProviderModules = (options: BuiltinProviderModulesOptions = {}): ProviderModule[] => {
  return BUILTIN_PROVIDER_MODULE_FACTORIES.map((factory) => createBuiltinProviderModule(factory, options));
};

export const BUILTIN_PROVIDER_MODULES = createBuiltinProviderModules();
