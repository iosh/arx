import { type AccountCodecRegistry, createAccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { ChainMetadata } from "../chains/metadata.js";
import { ChainAddressCodecRegistry } from "../chains/registry.js";
import type { HandlerControllers } from "../rpc/handlers/types.js";
import type { RpcClientRegistry } from "../rpc/RpcClientRegistry.js";
import type { RpcRegistry } from "../rpc/RpcRegistry.js";
import type { KeyringService } from "../runtime/keyring/KeyringService.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type {
  NamespaceApprovalBindings,
  NamespaceManifest,
  NamespaceRuntimeBindingsRegistry,
  NamespaceSignerRegistry,
  NamespaceUiBindings,
} from "./types.js";

const assertUniqueNamespaces = (manifests: readonly NamespaceManifest[]): void => {
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.namespace)) {
      throw new Error(`Duplicate namespace manifest "${manifest.namespace}"`);
    }
    seen.add(manifest.namespace);
  }
};

const createNamespaceRuntimeBindingsRegistry = (params: {
  approvalByNamespace: ReadonlyMap<string, NamespaceApprovalBindings>;
  uiByNamespace: ReadonlyMap<string, NamespaceUiBindings>;
}): NamespaceRuntimeBindingsRegistry => {
  const { approvalByNamespace, uiByNamespace } = params;

  return {
    getApproval: (namespace) => approvalByNamespace.get(namespace),
    getUi: (namespace) => uiByNamespace.get(namespace),
  };
};

export const collectChainSeedsFromManifests = (manifests: readonly NamespaceManifest[]): ChainMetadata[] => {
  return manifests.flatMap((manifest) => manifest.core.chainSeeds?.map((chain) => ({ ...chain })) ?? []);
};

export const createChainAddressCodecRegistryFromManifests = (
  manifests: readonly NamespaceManifest[],
): ChainAddressCodecRegistry => {
  assertUniqueNamespaces(manifests);
  return new ChainAddressCodecRegistry(manifests.map((manifest) => manifest.core.chainAddressCodec));
};

export const createAccountCodecRegistryFromManifests = (
  manifests: readonly NamespaceManifest[],
): AccountCodecRegistry => {
  assertUniqueNamespaces(manifests);
  return createAccountCodecRegistry(manifests.map((manifest) => manifest.core.accountCodec));
};

export const createKeyringNamespacesFromManifests = (manifests: readonly NamespaceManifest[]): NamespaceConfig[] => {
  assertUniqueNamespaces(manifests);
  return manifests.map((manifest) => ({
    ...manifest.core.keyring,
    factories: { ...manifest.core.keyring.factories },
  }));
};

export const registerRpcModulesFromManifests = (
  registry: RpcRegistry,
  manifests: readonly NamespaceManifest[],
): void => {
  assertUniqueNamespaces(manifests);

  const registered = new Set(registry.getRegisteredNamespaceAdapters().map((entry) => entry.namespace));
  for (const manifest of manifests) {
    const module = manifest.core.rpc;
    if (!registered.has(module.namespace)) {
      registry.registerNamespaceAdapter(module.adapter);
      registered.add(module.namespace);
    }
    registry.registerNamespaceProtocolAdapter(module.namespace, module.protocolAdapter);
  }
};

export const registerRpcClientFactoriesFromManifests = (
  registry: Pick<RpcClientRegistry, "registerFactory">,
  manifests: readonly NamespaceManifest[],
): void => {
  assertUniqueNamespaces(manifests);

  for (const manifest of manifests) {
    const factory = manifest.runtime?.clientFactory;
    if (factory) {
      registry.registerFactory(manifest.namespace, factory);
    }
  }
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

export const assembleRuntimeNamespaces = (params: {
  manifests: readonly NamespaceManifest[];
  transactionRegistry: TransactionAdapterRegistry;
  rpcClients: Pick<RpcClientRegistry, "getClient">;
  chains: ChainAddressCodecRegistry;
  keyring: Pick<KeyringService, "waitForReady" | "hasAccountId" | "signDigestByAccountId">;
}): { signers: HandlerControllers["signers"]; bindings: NamespaceRuntimeBindingsRegistry } => {
  const { manifests, transactionRegistry, rpcClients, chains, keyring } = params;
  assertUniqueNamespaces(manifests);

  const signerByNamespace = new Map<string, unknown>();
  const approvalByNamespace = new Map<string, NamespaceApprovalBindings>();
  const uiByNamespace = new Map<string, NamespaceUiBindings>();

  for (const manifest of manifests) {
    const createSigner = manifest.runtime?.createSigner;
    if (!createSigner) continue;
    signerByNamespace.set(manifest.namespace, createSigner({ keyring }));
  }

  for (const manifest of manifests) {
    const createApprovalBindings = manifest.runtime?.createApprovalBindings;
    if (createApprovalBindings) {
      const signer = signerByNamespace.get(manifest.namespace);
      if (!signer) {
        throw new Error(`Approval bindings for namespace "${manifest.namespace}" require a signer binding`);
      }
      approvalByNamespace.set(manifest.namespace, createApprovalBindings({ signer }));
    }

    const createUiBindings = manifest.runtime?.createUiBindings;
    if (createUiBindings) {
      uiByNamespace.set(
        manifest.namespace,
        createUiBindings({
          rpcClients,
          chains,
        }),
      );
    }
  }

  for (const manifest of manifests) {
    const createTransactionAdapter = manifest.runtime?.createTransactionAdapter;
    if (!createTransactionAdapter || transactionRegistry.get(manifest.namespace)) {
      continue;
    }

    const signer = signerByNamespace.get(manifest.namespace);
    if (!signer) {
      throw new Error(`Transaction adapter for namespace "${manifest.namespace}" requires a signer binding`);
    }

    const adapter = createTransactionAdapter({
      rpcClients,
      chains,
      signer,
    });
    transactionRegistry.register(manifest.namespace, adapter);
  }

  return {
    signers: createNamespaceSignerRegistry(signerByNamespace),
    bindings: createNamespaceRuntimeBindingsRegistry({
      approvalByNamespace,
      uiByNamespace,
    }),
  };
};
