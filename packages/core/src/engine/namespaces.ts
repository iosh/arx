import type { WalletNamespaceModule, WalletNamespaces } from "./types.js";
import { assertValidWalletNamespaceModule } from "./validation.js";

const createWalletDestroyedError = (): Error => {
  return new Error("ArxWallet is destroyed");
};

export const createWalletNamespaces = (params: {
  modules: readonly WalletNamespaceModule[];
  getIsDestroyed: () => boolean;
}): WalletNamespaces => {
  const { modules, getIsDestroyed } = params;

  const moduleByNamespace = new Map<string, WalletNamespaceModule>();
  for (const module of modules) {
    assertValidWalletNamespaceModule(module);

    if (moduleByNamespace.has(module.namespace)) {
      throw new Error(`Duplicate wallet namespace module "${module.namespace}"`);
    }

    moduleByNamespace.set(module.namespace, module);
  }

  const modulesSnapshot = [...moduleByNamespace.values()];

  const assertWalletIsActive = () => {
    if (getIsDestroyed()) {
      throw createWalletDestroyedError();
    }
  };

  const findModule = (namespace: string): WalletNamespaceModule | undefined => {
    assertWalletIsActive();
    return moduleByNamespace.get(namespace);
  };

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
    listModules: () => {
      assertWalletIsActive();
      return [...modulesSnapshot];
    },
    listNamespaces: () => {
      assertWalletIsActive();
      return modulesSnapshot.map((module) => module.namespace);
    },
  };
};
