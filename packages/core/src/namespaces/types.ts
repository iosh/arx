import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainDefinitionSeed } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { RpcEndpoint } from "../chains/metadata.js";
import type { ChainAddressCodecRegistry } from "../chains/registry.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { ChainRpcClientPool, RpcClientFactory } from "../rpc/ChainRpcClientPool.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type { AccountSigningService } from "../services/runtime/accountSigning.js";
import type { NamespaceTransaction } from "../transactions/namespace/types.js";

export type NamespaceCoreManifest = {
  namespace: string;
  rpc: RpcNamespaceModule;
  chainAddressCodec: ChainAddressCodec;
  accountCodec: AccountCodec;
  keyring: NamespaceConfig;
  chainSeeds?: readonly ChainDefinitionSeed<RpcEndpoint>[];
};

export type NamespaceApprovalBindings = {
  signMessage?: (params: { chainRef: ChainRef; address: string; message: string }) => Promise<string>;
  signTypedData?: (params: { chainRef: ChainRef; address: string; typedData: string }) => Promise<string>;
};

export type NamespaceUiBindings = {
  getNativeBalance?: (params: { chainRef: ChainRef; address: string }) => Promise<bigint>;
};

export type NamespaceRuntimeBindingsRegistry = {
  getApproval(namespace: string): NamespaceApprovalBindings | undefined;
  getUi(namespace: string): NamespaceUiBindings | undefined;
  hasTransactionReceiptTracking(namespace: string): boolean;
};

export type NamespaceRuntimeSupport = Readonly<{
  namespace: string;
  hasRpcClient: boolean;
  hasSigner: boolean;
  hasApprovalBindings: boolean;
  hasUiBindings: boolean;
  hasTransactionReceiptTracking: boolean;
}>;

export type NamespaceRuntimeSupportIndex = {
  get(namespace: string): NamespaceRuntimeSupport | undefined;
  require(namespace: string): NamespaceRuntimeSupport;
  list(): NamespaceRuntimeSupport[];
};

export type NamespaceSignerRegistry = {
  get<TSigner = unknown>(namespace: string): TSigner | undefined;
  require<TSigner = unknown>(namespace: string): TSigner;
  listNamespaces(): string[];
};

export type NamespaceRuntimeManifest = {
  clientFactory?: RpcClientFactory;
  createSigner?: (params: { accountSigning: AccountSigningService }) => unknown;
  createApprovalBindings?: (params: { signer: unknown }) => NamespaceApprovalBindings;
  createUiBindings?: (params: {
    rpcClients: Pick<ChainRpcClientPool, "getClient">;
    chains: ChainAddressCodecRegistry;
  }) => NamespaceUiBindings;
  createTransaction?: (params: {
    rpcClients: Pick<ChainRpcClientPool, "getClient">;
    chains: ChainAddressCodecRegistry;
    signer: unknown;
  }) => NamespaceTransaction;
};

export type NamespaceRuntimeSupportSpec = Readonly<
  {
    namespace: string;
  } & NamespaceRuntimeManifest
>;

export type NamespaceManifest = {
  namespace: string;
  core: NamespaceCoreManifest;
  runtime?: NamespaceRuntimeManifest;
};
