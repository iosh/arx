import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { NamespaceRuntimeManifest } from "../namespaces/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type { AccountsPort } from "../services/store/accounts/port.js";
import type { ChainDefinitionsPort } from "../services/store/chainDefinitions/port.js";
import type { KeyringMetasPort } from "../services/store/keyringMetas/port.js";
import type { NetworkPreferencesPort } from "../services/store/networkPreferences/port.js";
import type { PermissionsPort } from "../services/store/permissions/port.js";
import type { SettingsPort } from "../services/store/settings/port.js";
import type { TransactionsPort } from "../services/store/transactions/port.js";
import type { VaultMetaPort } from "../storage/index.js";

// Static namespace description that can be indexed and validated before boot.
export type NamespaceEngineFacts = Readonly<{
  /** Namespace id. */
  namespace: string;
  /** RPC module. */
  rpc: RpcNamespaceModule;
  /** Chain-address codec. */
  chainAddressCodec: ChainAddressCodec;
  /** Account codec. */
  accountCodec: AccountCodec;
  /** Keyring config. */
  keyring: NamespaceConfig;
  /** Seed chains. */
  chainSeeds?: readonly ChainMetadata[];
}>;

// Runtime factories contributed by a namespace module to the wallet engine.
export type NamespaceEngineFactories = Readonly<{
  /** RPC client factory. */
  clientFactory?: NonNullable<NamespaceRuntimeManifest["clientFactory"]>;
  /** Signer factory. */
  createSigner?: NonNullable<NamespaceRuntimeManifest["createSigner"]>;
  /** Approval bindings factory. */
  createApprovalBindings?: NonNullable<NamespaceRuntimeManifest["createApprovalBindings"]>;
  /** UI bindings factory. */
  createUiBindings?: NonNullable<NamespaceRuntimeManifest["createUiBindings"]>;
  /** Transaction adapter factory. */
  createTransactionAdapter?: NonNullable<NamespaceRuntimeManifest["createTransactionAdapter"]>;
}>;

// Engine-facing namespace definition split into static facts and executable factories.
export type NamespaceEngineDefinition = Readonly<{
  /** Static namespace facts. */
  facts: NamespaceEngineFacts;
  /** Runtime factories. */
  factories?: NamespaceEngineFactories;
}>;

// Single installed engine namespace module.
export type WalletNamespaceModule = Readonly<{
  /** Namespace id. */
  namespace: string;
  /** Engine definition. */
  engine: NamespaceEngineDefinition;
}>;

// Read-only installed namespace collection available while the wallet is alive.
export type WalletNamespaces = Readonly<{
  /** Get a module by namespace. */
  findModule(namespace: string): WalletNamespaceModule | undefined;
  /** Get a module or throw. */
  requireModule(namespace: string): WalletNamespaceModule;
  /** List installed modules. */
  listModules(): WalletNamespaceModule[];
  /** List installed namespace ids. */
  listNamespaces(): string[];
}>;

export type ArxWalletStoragePorts = Readonly<{
  accounts: AccountsPort;
  chainDefinitions: ChainDefinitionsPort;
  keyringMetas: KeyringMetasPort;
  networkPreferences: NetworkPreferencesPort;
  permissions: PermissionsPort;
  settings: SettingsPort;
  transactions: TransactionsPort;
}>;

export type CreateArxWalletInput = Readonly<{
  namespaces: Readonly<{
    /** Modules to install. */
    modules: readonly WalletNamespaceModule[];
  }>;
  storage: Readonly<{
    /** Required storage ports. */
    ports: ArxWalletStoragePorts;
    /** Vault metadata port. */
    vaultMetaPort?: VaultMetaPort;
    /** Whether to hydrate persisted state. */
    hydrate?: boolean;
  }>;
  env?: Readonly<{
    /** Clock override. */
    now?: () => number;
    /** Logger hook. */
    logger?: (message: string, error?: unknown) => void;
    /** UUID source override. */
    randomUuid?: () => string;
  }>;
}>;

export type ArxWallet = Readonly<{
  // Installed namespaces. Invalid after destroy().
  namespaces: WalletNamespaces;
  /** Stop the wallet runtime. */
  destroy(): Promise<void>;
}>;
