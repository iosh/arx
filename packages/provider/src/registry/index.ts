import { createEip155Module, type Eip155ModuleOptions } from "../namespaces/eip155/module.js";
import type { ProviderModule, ProviderRegistry } from "./types.js";

export type {
  Eip6963Info,
  ProviderDiscovery,
  ProviderEntry,
  ProviderInjection,
  ProviderModule,
  ProviderRegistry,
} from "./types.js";

export type ProviderRegistryOptions = {
  eip155?: Eip155ModuleOptions;
  // future: conflux?: ConfluxModuleOptions;
};

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
  const modules = [createEip155Module(options.eip155)] as const;
  return { modules, byNamespace: buildMap(modules) };
};
