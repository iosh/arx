import type { WalletNamespaceModule, WalletNamespaces } from "./types.js";
import { assertValidWalletNamespaceModule } from "./validation.js";

export const createWalletNamespaces = (params: { modules: readonly WalletNamespaceModule[] }): WalletNamespaces => {
  const { modules } = params;

  const moduleByNamespace = new Map<string, WalletNamespaceModule>();
  for (const module of modules) {
    assertValidWalletNamespaceModule(module);

    if (moduleByNamespace.has(module.namespace)) {
      throw new Error(`Duplicate wallet namespace module "${module.namespace}"`);
    }

    moduleByNamespace.set(module.namespace, module);
  }

  const modulesSnapshot = [...moduleByNamespace.values()];

  const findModule = (namespace: string): WalletNamespaceModule | undefined => moduleByNamespace.get(namespace);

  const requireModule = (namespace: string): WalletNamespaceModule => {
    const module = findModule(namespace);
    if (!module) {
      throw new Error(`Missing wallet namespace module "${namespace}"`);
    }
    return module;
  };

  return {
    findModule,
    requireModule,
    listModules: () => [...modulesSnapshot],
    listNamespaces: () => modulesSnapshot.map((module) => module.namespace),
  };
};
