import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodecRegistry } from "../chains/registry.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { RpcClientFactory, RpcClientRegistry } from "../rpc/RpcClientRegistry.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type { AccountSigningService } from "../services/runtime/accountSigning.js";
import type { NamespaceTransaction } from "../transactions/namespace/types.js";
import type { TransactionRequest } from "../transactions/types.js";

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
  getNativeBalance?: (params: { chainRef: ChainRef; address: string }) => Promise<bigint>;
  createSendTransactionRequest?: (params: { chainRef: ChainRef; to: string; valueWei: bigint }) => TransactionRequest;
};

export type NamespaceRuntimeBindingsRegistry = {
  getApproval(namespace: string): NamespaceApprovalBindings | undefined;
  getUi(namespace: string): NamespaceUiBindings | undefined;
  hasTransaction(namespace: string): boolean;
  hasTransactionReceiptTracking(namespace: string): boolean;
};

export type NamespaceRuntimeSupport = Readonly<{
  namespace: string;
  hasRpcClient: boolean;
  hasSigner: boolean;
  hasApprovalBindings: boolean;
  hasUiBindings: boolean;
  hasTransaction: boolean;
  hasTransactionReceiptTracking: boolean;
  hasTransactionReplacementTracking: boolean;
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
    rpcClients: Pick<RpcClientRegistry, "getClient">;
    chains: ChainAddressCodecRegistry;
  }) => NamespaceUiBindings;
  createTransaction?: (params: {
    rpcClients: Pick<RpcClientRegistry, "getClient">;
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
