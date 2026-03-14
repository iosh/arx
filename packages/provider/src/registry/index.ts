import { type BuiltinProviderModulesOptions, createBuiltinProviderModules } from "../namespaces/builtin.js";
import type { ProviderModule, ProviderRegistry } from "./types.js";

export type {
  Eip6963Info,
  ProviderDiscovery,
  ProviderEntry,
  ProviderInjection,
  ProviderModule,
  ProviderRegistry,
} from "./types.js";

export type ProviderRegistryOptions = BuiltinProviderModulesOptions;

const buildMap = (modules: ReadonlyArray<ProviderModule>) => {
  const byNamespace = new Map<string, ProviderModule>();
  for (const m of modules) {
    if (byNamespace.has(m.namespace)) {
      throw new Error(`Duplicate provider module namespace "${m.namespace}"`);
    }
    byNamespace.set(m.namespace, m);
  }
  return byNamespace;
};

export const createProviderRegistry = (options: ProviderRegistryOptions = {}): ProviderRegistry => {
  const modules = createBuiltinProviderModules(options);
  return { modules, byNamespace: buildMap(modules) };
};
