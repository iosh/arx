import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodecRegistry } from "../chains/registry.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { RpcClientFactory, RpcClientRegistry } from "../rpc/RpcClientRegistry.js";
import type { KeyringService } from "../runtime/keyring/KeyringService.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";

export type NamespaceCoreManifest = {
  namespace: string;
  rpc: RpcNamespaceModule;
  chainAddressCodec: ChainAddressCodec;
  accountCodec: AccountCodec;
  keyring: NamespaceConfig;
  chainSeeds?: readonly ChainMetadata[];
};

export type NamespaceApprovalBindings = {
  signMessage?: (params: { chainRef: ChainRef; address: string; message: string }) => Promise<string>;
  signTypedData?: (params: { chainRef: ChainRef; address: string; typedData: string }) => Promise<string>;
};

export type NamespaceUiBindings = {
  getNativeBalance: (params: { chainRef: ChainRef; address: string }) => Promise<bigint>;
};

export type NamespaceRuntimeBindingsRegistry = {
  getApproval(namespace: string): NamespaceApprovalBindings | undefined;
  getUi(namespace: string): NamespaceUiBindings | undefined;
};

export type NamespaceSignerRegistry = {
  get<TSigner = unknown>(namespace: string): TSigner | undefined;
  require<TSigner = unknown>(namespace: string): TSigner;
  listNamespaces(): string[];
};

export type NamespaceRuntimeManifest = {
  clientFactory?: RpcClientFactory;
  createSigner?: (params: {
    keyring: Pick<KeyringService, "waitForReady" | "hasAccountId" | "signDigestByAccountId">;
  }) => unknown;
  createApprovalBindings?: (params: { signer: unknown }) => NamespaceApprovalBindings;
  createUiBindings?: (params: {
    rpcClients: Pick<RpcClientRegistry, "getClient">;
    chains: ChainAddressCodecRegistry;
  }) => NamespaceUiBindings;
  createTransactionAdapter?: (params: {
    rpcClients: Pick<RpcClientRegistry, "getClient">;
    chains: ChainAddressCodecRegistry;
    signer: unknown;
  }) => TransactionAdapter;
};

export type NamespaceManifest = {
  namespace: string;
  core: NamespaceCoreManifest;
  runtime?: NamespaceRuntimeManifest;
};
