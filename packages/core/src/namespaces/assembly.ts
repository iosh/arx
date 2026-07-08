import {
  type AccountAddressingByNamespace,
  buildAccountAddressingByNamespace,
} from "../accounts/addressing/addressing.js";
import { buildChainAddressingByNamespace, type ChainAddressingByNamespace } from "../chains/addressing.js";
import { parseChainRef } from "../chains/caip.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../chains/definition.js";
import { ChainNotCompatibleError } from "../chains/errors.js";
import type { AccountSigningService } from "../keyring/accountSigning.js";
import type { ChainRpcClientPool, RpcClientFactory } from "../rpc/ChainRpcClientPool.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import { buildRpcRouting, type RpcRouting } from "../rpc/routing.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type { AnyNamespaceTransaction } from "../transactions/namespace/types.js";
import type {
  NamespaceApprovalBindings,
  NamespaceManifest,
  NamespaceRuntimeServices,
  NamespaceUiBindings,
} from "./types.js";

export type NamespaceRpcClientFactory = Readonly<{
  namespace: string;
  factory: RpcClientFactory;
}>;

export type NamespaceStaticAssembly = Readonly<{
  manifests: readonly NamespaceManifest[];
  rpcModules: readonly RpcNamespaceModule[];
  rpcRouting: RpcRouting;
  rpcClientFactories: readonly NamespaceRpcClientFactory[];
  accountAddressing: AccountAddressingByNamespace;
  chainAddressing: ChainAddressingByNamespace;
  chainSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[];
  keyringNamespaces: readonly NamespaceConfig[];
}>;

export type NamespaceRuntimeAssembly = Readonly<{
  namespaceTransactions: NamespaceTransactions;
  services: NamespaceRuntimeServices;
}>;

type MaterializedNamespaceRuntime = {
  approvals: NamespaceApprovalBindings;
  ui: NamespaceUiBindings;
};

const collectRpcModulesFromManifests = (manifests: readonly NamespaceManifest[]): readonly RpcNamespaceModule[] =>
  manifests.map((manifest) => manifest.core.rpc);

export const collectChainSeedsFromManifests = (
  manifests: readonly NamespaceManifest[],
): ChainDefinitionSeed<RpcEndpoint>[] => {
  return manifests.flatMap((manifest) => manifest.core.chainSeeds ?? []);
};

export const buildChainAddressingByNamespaceFromManifests = (
  manifests: readonly NamespaceManifest[],
): ChainAddressingByNamespace => {
  return buildChainAddressingByNamespace(manifests.map((manifest) => manifest.core.chainAddressing));
};

export const buildAccountAddressingByNamespaceFromManifests = (
  manifests: readonly NamespaceManifest[],
): AccountAddressingByNamespace => {
  return buildAccountAddressingByNamespace(manifests.map((manifest) => manifest.core.accountAddressing));
};

export const createKeyringNamespacesFromManifests = (manifests: readonly NamespaceManifest[]): NamespaceConfig[] => {
  return manifests.map((manifest) => manifest.core.keyring);
};

const createRpcClientFactoriesFromManifests = (
  manifests: readonly NamespaceManifest[],
): NamespaceRpcClientFactory[] => {
  return manifests.map((manifest) => ({
    namespace: manifest.namespace,
    factory: manifest.runtime.clientFactory,
  }));
};

export const assembleNamespaceStatic = (manifests: readonly NamespaceManifest[]): NamespaceStaticAssembly => {
  const rpcModules = collectRpcModulesFromManifests(manifests);

  return {
    manifests,
    rpcModules,
    rpcRouting: buildRpcRouting(rpcModules.map((module) => module.adapter)),
    rpcClientFactories: createRpcClientFactoriesFromManifests(manifests),
    accountAddressing: buildAccountAddressingByNamespaceFromManifests(manifests),
    chainAddressing: buildChainAddressingByNamespaceFromManifests(manifests),
    chainSeeds: collectChainSeedsFromManifests(manifests),
    keyringNamespaces: createKeyringNamespacesFromManifests(manifests),
  };
};

const materializeNamespaceTransactions = (params: {
  manifests: readonly NamespaceManifest[];
  rpcClients: Pick<ChainRpcClientPool, "getClient">;
  chains: ChainAddressingByNamespace;
  signerByNamespace: ReadonlyMap<string, unknown>;
  transactionOverrides?: NamespaceTransactions;
}): NamespaceTransactions => {
  const transactionEntries: Array<[string, AnyNamespaceTransaction]> = [];
  const overrideByNamespace = new Map(params.transactionOverrides?.entries() ?? []);

  for (const manifest of params.manifests) {
    const overriddenTransaction = overrideByNamespace.get(manifest.namespace);
    if (overriddenTransaction) {
      transactionEntries.push([manifest.namespace, overriddenTransaction]);
      overrideByNamespace.delete(manifest.namespace);
      continue;
    }

    const signer = params.signerByNamespace.get(manifest.namespace);

    const transaction = manifest.runtime.createTransaction({
      rpcClients: params.rpcClients,
      chains: params.chains,
      signer,
    });
    transactionEntries.push([manifest.namespace, transaction]);
  }

  return new NamespaceTransactions(transactionEntries);
};

const namespaceRuntimeFor = (
  runtimes: ReadonlyMap<string, MaterializedNamespaceRuntime>,
  namespace: string,
): MaterializedNamespaceRuntime => {
  const runtime = runtimes.get(namespace);
  if (runtime) return runtime;

  throw new ChainNotCompatibleError({
    message: `Namespace runtime is not available for "${namespace}".`,
  });
};

const namespaceRuntimeForChainRef = (
  runtimes: ReadonlyMap<string, MaterializedNamespaceRuntime>,
  chainRef: string,
): MaterializedNamespaceRuntime => {
  return namespaceRuntimeFor(runtimes, parseChainRef(chainRef).namespace);
};

export const materializeNamespaceRuntime = (params: {
  manifests: readonly NamespaceManifest[];
  rpcClients: Pick<ChainRpcClientPool, "getClient">;
  chains: ChainAddressingByNamespace;
  accountSigning: AccountSigningService;
  transactionOverrides?: NamespaceTransactions;
}): NamespaceRuntimeAssembly => {
  const { manifests, rpcClients, chains, accountSigning, transactionOverrides } = params;
  const signerByNamespace = new Map<string, unknown>();
  const namespaceRuntimeByNamespace = new Map<string, MaterializedNamespaceRuntime>();

  for (const manifest of manifests) {
    signerByNamespace.set(manifest.namespace, manifest.runtime.createSigner({ accountSigning }));
  }

  for (const manifest of manifests) {
    const signer = signerByNamespace.get(manifest.namespace);

    namespaceRuntimeByNamespace.set(manifest.namespace, {
      approvals: manifest.runtime.createApprovalBindings({ signer }),
      ui: manifest.runtime.createUiBindings({ rpcClients, chains }),
    });
  }

  return {
    namespaceTransactions: materializeNamespaceTransactions({
      manifests,
      rpcClients,
      chains,
      signerByNamespace,
      ...(transactionOverrides ? { transactionOverrides } : {}),
    }),
    services: {
      approvals: {
        signMessage: (input) =>
          namespaceRuntimeForChainRef(namespaceRuntimeByNamespace, input.chainRef).approvals.signMessage(input),
        signTypedData: (input) =>
          namespaceRuntimeForChainRef(namespaceRuntimeByNamespace, input.chainRef).approvals.signTypedData(input),
      },
      ui: {
        getNativeBalance: (input) =>
          namespaceRuntimeForChainRef(namespaceRuntimeByNamespace, input.chainRef).ui.getNativeBalance(input),
      },
    },
  };
};
