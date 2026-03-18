import { type AccountCodecRegistry, createAccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { ChainAddressCodecRegistry } from "../chains/registry.js";
import type { HandlerControllers } from "../rpc/handlers/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { RpcClientRegistry } from "../rpc/RpcClientRegistry.js";
import type { RpcRegistry } from "../rpc/RpcRegistry.js";
import type { KeyringService } from "../runtime/keyring/KeyringService.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type {
  NamespaceApprovalBindings,
  NamespaceManifest,
  NamespaceRuntimeBindingsRegistry,
  NamespaceRuntimeSupport,
  NamespaceRuntimeSupportIndex,
  NamespaceRuntimeSupportSpec,
  NamespaceSignerRegistry,
  NamespaceUiBindings,
} from "./types.js";
import { assertValidNamespaceManifest } from "./validation.js";

export type RuntimeBootstrapNamespaceAssembly = Readonly<{
  rpcModules: readonly RpcNamespaceModule[];
  accountCodecs: AccountCodecRegistry;
  chainAddressCodecs: ChainAddressCodecRegistry;
  chainSeeds: readonly ChainMetadata[];
}>;

export type RuntimeSessionNamespaceAssembly = Readonly<{
  keyringNamespaces: readonly NamespaceConfig[];
}>;

export type RuntimeNamespaceRuntimeSupportAssembly = Readonly<{
  namespaces: readonly NamespaceRuntimeSupportSpec[];
}>;

export type RuntimeNamespaceStageAssembly = Readonly<{
  bootstrap: RuntimeBootstrapNamespaceAssembly;
  session: RuntimeSessionNamespaceAssembly;
  runtimeSupport: RuntimeNamespaceRuntimeSupportAssembly;
}>;

const assertValidRuntimeSupportDependencies = (manifest: NamespaceManifest): void => {
  const runtime = manifest.runtime;
  if (!runtime) {
    return;
  }

  if (runtime.createApprovalBindings && !runtime.createSigner) {
    throw new Error(
      `Namespace manifest "${manifest.namespace}" runtime.createApprovalBindings requires runtime.createSigner`,
    );
  }

  if (runtime.createTransactionAdapter && !runtime.createSigner) {
    throw new Error(
      `Namespace manifest "${manifest.namespace}" runtime.createTransactionAdapter requires runtime.createSigner`,
    );
  }
};

const assertValidUniqueNamespaceManifests = (manifests: readonly NamespaceManifest[]): void => {
  const seen = new Set<string>();
  for (const manifest of manifests) {
    assertValidNamespaceManifest(manifest);
    assertValidRuntimeSupportDependencies(manifest);
    if (seen.has(manifest.namespace)) {
      throw new Error(`Duplicate namespace manifest "${manifest.namespace}"`);
    }
    seen.add(manifest.namespace);
  }
};

const getValidatedUniqueNamespaceManifests = (
  manifests: readonly NamespaceManifest[],
): readonly NamespaceManifest[] => {
  assertValidUniqueNamespaceManifests(manifests);
  return manifests;
};

const collectRpcModulesFromValidatedManifests = (
  manifests: readonly NamespaceManifest[],
): readonly RpcNamespaceModule[] => {
  return manifests.map((manifest) => manifest.core.rpc);
};

const collectChainSeedsFromValidatedManifests = (manifests: readonly NamespaceManifest[]): ChainMetadata[] => {
  return manifests.flatMap((manifest) => manifest.core.chainSeeds?.map((chain) => ({ ...chain })) ?? []);
};

const createChainAddressCodecRegistryFromValidatedManifests = (
  manifests: readonly NamespaceManifest[],
): ChainAddressCodecRegistry => {
  return new ChainAddressCodecRegistry(manifests.map((manifest) => manifest.core.chainAddressCodec));
};

const createAccountCodecRegistryFromValidatedManifests = (
  manifests: readonly NamespaceManifest[],
): AccountCodecRegistry => {
  return createAccountCodecRegistry(manifests.map((manifest) => manifest.core.accountCodec));
};

const createKeyringNamespacesFromValidatedManifests = (manifests: readonly NamespaceManifest[]): NamespaceConfig[] => {
  return manifests.map((manifest) => ({
    ...manifest.core.keyring,
    factories: { ...manifest.core.keyring.factories },
  }));
};

const createRuntimeSupportSpecsFromValidatedManifests = (
  manifests: readonly NamespaceManifest[],
): NamespaceRuntimeSupportSpec[] => {
  return manifests.map((manifest) => ({
    namespace: manifest.namespace,
    ...(manifest.runtime?.clientFactory ? { clientFactory: manifest.runtime.clientFactory } : {}),
    ...(manifest.runtime?.createSigner ? { createSigner: manifest.runtime.createSigner } : {}),
    ...(manifest.runtime?.createApprovalBindings
      ? { createApprovalBindings: manifest.runtime.createApprovalBindings }
      : {}),
    ...(manifest.runtime?.createUiBindings ? { createUiBindings: manifest.runtime.createUiBindings } : {}),
    ...(manifest.runtime?.createTransactionAdapter
      ? { createTransactionAdapter: manifest.runtime.createTransactionAdapter }
      : {}),
  }));
};

const createNamespaceRuntimeBindingsRegistry = (params: {
  approvalByNamespace: ReadonlyMap<string, NamespaceApprovalBindings>;
  uiByNamespace: ReadonlyMap<string, NamespaceUiBindings>;
  transactionNamespaces: ReadonlySet<string>;
}): NamespaceRuntimeBindingsRegistry => {
  const { approvalByNamespace, uiByNamespace, transactionNamespaces } = params;

  return {
    getApproval: (namespace) => approvalByNamespace.get(namespace),
    getUi: (namespace) => uiByNamespace.get(namespace),
    hasTransaction: (namespace) => transactionNamespaces.has(namespace),
  };
};

const createNamespaceRuntimeSupportIndex = (
  supportByNamespace: ReadonlyMap<string, NamespaceRuntimeSupport>,
): NamespaceRuntimeSupportIndex => {
  return {
    get: (namespace) => supportByNamespace.get(namespace),
    require: (namespace) => {
      const support = supportByNamespace.get(namespace);
      if (!support) {
        throw new Error(`Missing runtime support for namespace "${namespace}"`);
      }
      return support;
    },
    list: () => [...supportByNamespace.values()],
  };
};

export const assembleRuntimeNamespaceStages = (
  manifests: readonly NamespaceManifest[],
): RuntimeNamespaceStageAssembly => {
  const validatedManifests = getValidatedUniqueNamespaceManifests(manifests);

  return {
    bootstrap: {
      rpcModules: collectRpcModulesFromValidatedManifests(validatedManifests),
      accountCodecs: createAccountCodecRegistryFromValidatedManifests(validatedManifests),
      chainAddressCodecs: createChainAddressCodecRegistryFromValidatedManifests(validatedManifests),
      chainSeeds: collectChainSeedsFromValidatedManifests(validatedManifests),
    },
    session: {
      keyringNamespaces: createKeyringNamespacesFromValidatedManifests(validatedManifests),
    },
    runtimeSupport: {
      namespaces: createRuntimeSupportSpecsFromValidatedManifests(validatedManifests),
    },
  };
};

export const collectChainSeedsFromManifests = (manifests: readonly NamespaceManifest[]): ChainMetadata[] => {
  return collectChainSeedsFromValidatedManifests(getValidatedUniqueNamespaceManifests(manifests));
};

export const createChainAddressCodecRegistryFromManifests = (
  manifests: readonly NamespaceManifest[],
): ChainAddressCodecRegistry => {
  return createChainAddressCodecRegistryFromValidatedManifests(getValidatedUniqueNamespaceManifests(manifests));
};

export const createAccountCodecRegistryFromManifests = (
  manifests: readonly NamespaceManifest[],
): AccountCodecRegistry => {
  return createAccountCodecRegistryFromValidatedManifests(getValidatedUniqueNamespaceManifests(manifests));
};

export const createKeyringNamespacesFromManifests = (manifests: readonly NamespaceManifest[]): NamespaceConfig[] => {
  return createKeyringNamespacesFromValidatedManifests(getValidatedUniqueNamespaceManifests(manifests));
};

export const registerRpcModules = (registry: RpcRegistry, modules: readonly RpcNamespaceModule[]): void => {
  const seen = new Set<string>();
  for (const module of modules) {
    if (seen.has(module.namespace)) {
      throw new Error(`Duplicate RPC namespace module "${module.namespace}"`);
    }
    seen.add(module.namespace);
  }

  const registered = new Set(registry.getRegisteredNamespaceAdapters().map((entry) => entry.namespace));
  for (const module of modules) {
    if (!registered.has(module.namespace)) {
      registry.registerNamespaceAdapter(module.adapter);
      registered.add(module.namespace);
    }
    registry.registerNamespaceProtocolAdapter(module.namespace, module.protocolAdapter);
  }
};

export const registerRpcModulesFromManifests = (
  registry: RpcRegistry,
  manifests: readonly NamespaceManifest[],
): void => {
  registerRpcModules(
    registry,
    collectRpcModulesFromValidatedManifests(getValidatedUniqueNamespaceManifests(manifests)),
  );
};

const createNamespaceSignerRegistry = (signerByNamespace: ReadonlyMap<string, unknown>): NamespaceSignerRegistry => {
  return {
    get: <TSigner = unknown>(namespace: string) => signerByNamespace.get(namespace) as TSigner | undefined,
    require: <TSigner = unknown>(namespace: string) => {
      const signer = signerByNamespace.get(namespace);
      if (!signer) {
        throw new Error(`Missing signer binding for namespace "${namespace}"`);
      }
      return signer as TSigner;
    },
    listNamespaces: () => [...signerByNamespace.keys()],
  };
};

export const materializeNamespaceRuntimeSupport = (params: {
  runtimeSupport: RuntimeNamespaceRuntimeSupportAssembly;
  transactionRegistry: TransactionAdapterRegistry;
  rpcClients: Pick<RpcClientRegistry, "getClient">;
  chains: ChainAddressCodecRegistry;
  keyring: Pick<KeyringService, "waitForReady" | "hasAccountKey" | "signDigestByAccountKey">;
  rpcClientNamespaces: ReadonlySet<string>;
}): {
  signers: HandlerControllers["signers"];
  bindings: NamespaceRuntimeBindingsRegistry;
  runtimeSupport: NamespaceRuntimeSupportIndex;
} => {
  const { runtimeSupport, transactionRegistry, rpcClients, chains, keyring, rpcClientNamespaces } = params;

  const signerByNamespace = new Map<string, unknown>();
  const approvalByNamespace = new Map<string, NamespaceApprovalBindings>();
  const uiByNamespace = new Map<string, NamespaceUiBindings>();
  const supportByNamespace = new Map<string, NamespaceRuntimeSupport>();

  for (const spec of runtimeSupport.namespaces) {
    const createSigner = spec.createSigner;
    if (!createSigner) continue;
    signerByNamespace.set(spec.namespace, createSigner({ keyring }));
  }

  for (const spec of runtimeSupport.namespaces) {
    const createApprovalBindings = spec.createApprovalBindings;
    if (createApprovalBindings) {
      const signer = signerByNamespace.get(spec.namespace);
      if (!signer) {
        throw new Error(`Approval bindings for namespace "${spec.namespace}" require a signer binding`);
      }
      approvalByNamespace.set(spec.namespace, createApprovalBindings({ signer }));
    }

    const createUiBindings = spec.createUiBindings;
    if (createUiBindings) {
      uiByNamespace.set(
        spec.namespace,
        createUiBindings({
          rpcClients,
          chains,
        }),
      );
    }
  }

  for (const spec of runtimeSupport.namespaces) {
    const createTransactionAdapter = spec.createTransactionAdapter;
    if (!createTransactionAdapter || transactionRegistry.get(spec.namespace)) {
      continue;
    }

    const signer = signerByNamespace.get(spec.namespace);
    if (!signer) {
      throw new Error(`Transaction adapter for namespace "${spec.namespace}" requires a signer binding`);
    }

    const adapter = createTransactionAdapter({
      rpcClients,
      chains,
      signer,
    });
    transactionRegistry.register(spec.namespace, adapter);
  }

  const transactionNamespaces = new Set(transactionRegistry.listNamespaces());
  for (const spec of runtimeSupport.namespaces) {
    const approvalBindings = approvalByNamespace.get(spec.namespace);
    const uiBindings = uiByNamespace.get(spec.namespace);

    supportByNamespace.set(spec.namespace, {
      namespace: spec.namespace,
      hasRpcClient: rpcClientNamespaces.has(spec.namespace),
      hasSigner: signerByNamespace.has(spec.namespace),
      hasApprovalBindings: Boolean(approvalBindings?.signMessage || approvalBindings?.signTypedData),
      hasUiBindings: Boolean(uiBindings?.getNativeBalance || uiBindings?.createSendTransactionRequest),
      hasTransaction: transactionNamespaces.has(spec.namespace),
    });
  }

  return {
    signers: createNamespaceSignerRegistry(signerByNamespace),
    bindings: createNamespaceRuntimeBindingsRegistry({
      approvalByNamespace,
      uiByNamespace,
      transactionNamespaces,
    }),
    runtimeSupport: createNamespaceRuntimeSupportIndex(supportByNamespace),
  };
};
