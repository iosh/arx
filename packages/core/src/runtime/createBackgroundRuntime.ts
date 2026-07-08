import type { AccountsPort } from "../accounts/accountsPort.js";
import type { AccountAddressingByNamespace } from "../accounts/addressing/addressing.js";
import type { createChainActivationService } from "../chains/activation/index.js";
import type { ChainRpcDefaultEndpointsPort } from "../chains/rpc/defaultEndpoints/port.js";
import type { ChainRpcEndpointOverridesPort } from "../chains/rpc/endpointOverrides/port.js";
import type { ChainDefinitionsPort } from "../chains/runtime/chainDefinitions/port.js";
import type { ProviderChainSelectionPort } from "../chains/selection/provider/port.js";
import type { ProviderChainSelectionService } from "../chains/selection/provider/types.js";
import type { WalletChainSelectionPort } from "../chains/selection/wallet/port.js";
import type { WalletChainSelectionService } from "../chains/selection/wallet/types.js";
import type { createChainViewsService } from "../chains/views/index.js";
import { assembleArxWalletRuntime } from "../engine/createArxWallet.js";
import type { ArxWallet } from "../engine/types.js";
import type { AccountSigningService } from "../keyring/accountSigning.js";
import type { KeyringMetasPort } from "../keyring/keyringMetasPort.js";
import type { Messenger } from "../messenger/index.js";
import type { NamespaceManifest } from "../namespaces/types.js";
import type { PermissionsPort } from "../permissions/service/port.js";
import type { createPermissionViewsService } from "../permissions/views/index.js";
import type { Namespace } from "../rpc/handlers/types.js";
import type { RpcInvocationHint, resolveRpcInvocation, resolveRpcInvocationDetails } from "../rpc/index.js";
import type { VaultMetaPort } from "../storage/index.js";
import type { TransactionsStoragePort } from "../transactions/storage/index.js";
import type { createAttentionService } from "../wallet/attention/index.js";
import type { BackgroundStateServices } from "./background/backgroundStateServices.js";
import type { BackgroundRpcAccessPolicyHooks } from "./background/rpcAccessPolicy.js";
import type { initRpcLayer, RpcLayerOptions } from "./background/rpcLayer.js";
import type { BackgroundAssemblyOptions } from "./background/runtimeScopes.js";
import type { BackgroundSessionServices, SessionOptions } from "./background/session.js";
import type { KeyringService } from "./keyring/KeyringService.js";
import type { ProviderRuntimeAccess } from "./provider/types.js";

export type { BackgroundSessionServices } from "./background/session.js";

export type CreateBackgroundRuntimeOptions = Omit<BackgroundAssemblyOptions, "chainDefinitions"> & {
  rpcAccessPolicy: BackgroundRpcAccessPolicyHooks;
  walletChainSelection: {
    port: WalletChainSelectionPort;
  };
  providerChainSelection: {
    port: ProviderChainSelectionPort;
  };
  chainRpcEndpointOverrides: {
    port: ChainRpcEndpointOverridesPort;
  };
  chainRpcDefaultEndpoints: {
    port: ChainRpcDefaultEndpointsPort;
  };
  storage?: {
    vaultMetaPort?: VaultMetaPort;
    hydrate?: boolean;
  };
  store: {
    ports: {
      accounts: AccountsPort;
      chainDefinitions: ChainDefinitionsPort;
      keyringMetas: KeyringMetasPort;
      permissions: PermissionsPort;
      transactionAggregates: TransactionsStoragePort;
    };
  };
  chainDefinitions: Omit<BackgroundAssemblyOptions["chainDefinitions"], "port">;
  session?: SessionOptions;
  rpcClients?: RpcLayerOptions;
  namespaces: {
    manifests: readonly NamespaceManifest[];
  };
};

export type BackgroundRuntime = {
  messenger: Messenger;
  transactions: ReturnType<typeof assembleArxWalletRuntime>["transactions"];
  transactionMonitor: ReturnType<typeof assembleArxWalletRuntime>["transactionMonitor"];
  services: BackgroundStateServices & {
    attention: ReturnType<typeof createAttentionService>;
    chainActivation: ReturnType<typeof createChainActivationService>;
    chainViews: ReturnType<typeof createChainViewsService>;
    permissionViews: ReturnType<typeof createPermissionViewsService>;
    accountAddressing: AccountAddressingByNamespace;
    walletChainSelection: WalletChainSelectionService;
    providerChainSelection: ProviderChainSelectionService;
    namespaceRuntime: ReturnType<typeof assembleArxWalletRuntime>["services"]["namespaceRuntime"];
    session: BackgroundSessionServices;
    accountSigning: AccountSigningService;
    keyring: KeyringService;
  };
  rpc: {
    routing: ReturnType<typeof assembleArxWalletRuntime>["rpc"]["routing"];
    clients: ReturnType<typeof initRpcLayer>;
    resolveHintNamespace: (hint?: RpcInvocationHint) => Namespace | null;
    resolveMethodNamespace: (method: string, hint?: RpcInvocationHint) => Namespace | null;
    resolveInvocation: (method: string, hint?: RpcInvocationHint) => ReturnType<typeof resolveRpcInvocation>;
    resolveInvocationDetails: (
      method: string,
      hint?: RpcInvocationHint,
    ) => ReturnType<typeof resolveRpcInvocationDetails>;
    executeRequest: ReturnType<typeof assembleArxWalletRuntime>["rpc"]["executeRequest"];
  };
  lifecycle: ReturnType<typeof assembleArxWalletRuntime>["lifecycle"];
  providerAccess: ProviderRuntimeAccess;
  wallet: ArxWallet;
};

const createNoopVaultMetaPort = (): VaultMetaPort => ({
  async loadVaultMeta() {
    return null;
  },
  async saveVaultMeta() {},
  async clearVaultMeta() {},
});

export const createBackgroundRuntime = (options: CreateBackgroundRuntimeOptions): BackgroundRuntime => {
  const chainDefinitionsPort = options.store.ports.chainDefinitions;
  const chainDefinitions = {
    ...options.chainDefinitions,
    port: chainDefinitionsPort,
  };

  const walletChainSelectionPort = options.walletChainSelection.port;
  const providerChainSelectionPort = options.providerChainSelection.port;
  const chainRpcDefaultEndpointsPort = options.chainRpcDefaultEndpoints.port;
  const chainRpcEndpointOverridesPort = options.chainRpcEndpointOverrides.port;
  const vaultMetaPort = options.storage?.vaultMetaPort ?? createNoopVaultMetaPort();

  const runtime = assembleArxWalletRuntime({
    namespaces: options.namespaces,
    storage: {
      ports: {
        vault: vaultMetaPort,
        keyrings: options.store.ports.keyringMetas,
        accounts: options.store.ports.accounts,
        permissions: options.store.ports.permissions,
        chains: {
          chainDefinitions: chainDefinitionsPort,
          chainRpcDefaultEndpoints: chainRpcDefaultEndpointsPort,
          chainRpcEndpointOverrides: chainRpcEndpointOverridesPort,
          walletChainSelection: walletChainSelectionPort,
          providerChainSelection: providerChainSelectionPort,
        },
        transactions: options.store.ports.transactionAggregates,
      },
      ...(options.storage?.hydrate !== undefined ? { hydrate: options.storage.hydrate } : {}),
    },
    runtime: {
      boot: false,
      lifecycleLabel: "createBackgroundRuntime",
      assemblyOptions: {
        ...(options.approvals ? { approvals: options.approvals } : {}),
        ...(options.transactions ? { transactions: options.transactions } : {}),
        chainDefinitions,
      },
      ...(options.rpcClients ? { rpcClients: options.rpcClients } : {}),
      rpcAccessPolicy: options.rpcAccessPolicy,
      ...(options.session ? { session: options.session } : {}),
    },
  });

  return {
    messenger: runtime.messenger,
    transactions: runtime.transactions,
    transactionMonitor: runtime.transactionMonitor,
    services: runtime.services,
    rpc: {
      routing: runtime.rpc.routing,
      clients: runtime.rpc.clients,
      resolveHintNamespace: runtime.rpc.resolveHintNamespace,
      resolveMethodNamespace: runtime.rpc.resolveMethodNamespace,
      resolveInvocation: runtime.rpc.resolveInvocation,
      resolveInvocationDetails: runtime.rpc.resolveInvocationDetails,
      executeRequest: runtime.rpc.executeRequest,
    },
    lifecycle: runtime.lifecycle,
    providerAccess: runtime.providerAccess,
    wallet: runtime.wallet,
  };
};
