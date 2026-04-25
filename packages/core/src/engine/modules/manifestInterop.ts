import type { ChainMetadata } from "../../chains/metadata.js";
import { assembleRuntimeNamespaceStages, type RuntimeNamespaceStageAssembly } from "../../namespaces/assembly.js";
import type { NamespaceManifest, NamespaceRuntimeManifest } from "../../namespaces/types.js";
import type { NamespaceEngineFactories, WalletNamespaceModule } from "../types.js";

const cloneChainSeeds = (chainSeeds?: readonly ChainMetadata[]): ChainMetadata[] | undefined => {
  return chainSeeds?.map((chain) => ({ ...chain }));
};

const cloneKeyringConfig = <T extends { factories: Record<string, unknown> }>(keyring: T): T => {
  return {
    ...keyring,
    factories: { ...keyring.factories },
  };
};

const buildNamespaceEngineFactories = (manifest: NamespaceManifest): NamespaceEngineFactories | undefined => {
  const factories: Record<string, unknown> = {};

  if (manifest.runtime && "clientFactory" in manifest.runtime) {
    factories.clientFactory = manifest.runtime.clientFactory;
  } else if (manifest.core.rpc.clientFactory) {
    factories.clientFactory = manifest.core.rpc.clientFactory;
  }
  if (manifest.runtime?.createSigner) {
    factories.createSigner = manifest.runtime.createSigner;
  }
  if (manifest.runtime?.createApprovalBindings) {
    factories.createApprovalBindings = manifest.runtime.createApprovalBindings;
  }
  if (manifest.runtime?.createUiBindings) {
    factories.createUiBindings = manifest.runtime.createUiBindings;
  }
  if (manifest.runtime?.createTransaction) {
    factories.createTransaction = manifest.runtime.createTransaction;
  }

  return Object.keys(factories).length > 0 ? (factories as NamespaceEngineFactories) : undefined;
};

const buildNamespaceRuntimeManifest = (params: {
  module: WalletNamespaceModule;
}): NamespaceRuntimeManifest | undefined => {
  const { module } = params;
  const runtime: NamespaceRuntimeManifest = {};

  if (module.engine.factories && "clientFactory" in module.engine.factories) {
    runtime.clientFactory = module.engine.factories.clientFactory;
  } else if (module.engine.facts.rpc.clientFactory) {
    runtime.clientFactory = module.engine.facts.rpc.clientFactory;
  }
  if (module.engine.factories?.createSigner) {
    runtime.createSigner = module.engine.factories.createSigner;
  }
  if (module.engine.factories?.createApprovalBindings) {
    runtime.createApprovalBindings = module.engine.factories.createApprovalBindings;
  }
  if (module.engine.factories?.createUiBindings) {
    runtime.createUiBindings = module.engine.factories.createUiBindings;
  }
  if (module.engine.factories?.createTransaction) {
    runtime.createTransaction = module.engine.factories.createTransaction;
  }

  return Object.keys(runtime).length > 0 ? runtime : undefined;
};

export const createWalletNamespaceModuleFromManifest = (manifest: NamespaceManifest): WalletNamespaceModule => {
  const chainSeeds = manifest.core.chainSeeds ? cloneChainSeeds(manifest.core.chainSeeds) : undefined;
  const factories = buildNamespaceEngineFactories(manifest);

  return {
    namespace: manifest.namespace,
    engine: {
      facts: {
        namespace: manifest.namespace,
        rpc: manifest.core.rpc,
        chainAddressCodec: manifest.core.chainAddressCodec,
        accountCodec: manifest.core.accountCodec,
        keyring: cloneKeyringConfig(manifest.core.keyring),
        ...(chainSeeds ? { chainSeeds } : {}),
      },
      ...(factories ? { factories } : {}),
    },
  };
};

export const createNamespaceManifestFromWalletNamespaceModule = (module: WalletNamespaceModule): NamespaceManifest => {
  const { facts } = module.engine;
  const chainSeeds = facts.chainSeeds ? cloneChainSeeds(facts.chainSeeds) : undefined;
  const runtime = buildNamespaceRuntimeManifest({ module });

  return {
    namespace: module.namespace,
    core: {
      namespace: facts.namespace,
      rpc: facts.rpc,
      chainAddressCodec: facts.chainAddressCodec,
      accountCodec: facts.accountCodec,
      keyring: cloneKeyringConfig(facts.keyring),
      ...(chainSeeds ? { chainSeeds } : {}),
    },
    ...(runtime ? { runtime } : {}),
  };
};

export const assembleRuntimeNamespaceStagesFromWalletModules = (
  modules: readonly WalletNamespaceModule[],
): RuntimeNamespaceStageAssembly => {
  return assembleRuntimeNamespaceStages(
    modules.map((module) => createNamespaceManifestFromWalletNamespaceModule(module)),
  );
};
