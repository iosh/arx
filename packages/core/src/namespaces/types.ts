import type { NamespaceAccountAddressing } from "../accounts/addressing/addressing.js";
import type { ChainAddressingByNamespace } from "../chains/addressing.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { NamespaceChainAddressing } from "../chains/types.js";
import type { AccountSigningService } from "../keyring/accountSigning.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { ChainRpcClientPool, RpcClientFactory } from "../rpc/ChainRpcClientPool.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { NamespaceTransaction } from "../transactions/namespace/types.js";
import type { TransactionNamespaceAdapter } from "../transactions/transactionNamespace.js";

export type NamespaceCoreManifest<TNamespace extends string = string> = {
  rpc: RpcNamespaceModule;
  chainAddressing: NamespaceChainAddressing;
  accountAddressing: NamespaceAccountAddressing;
  keyringAdapter: KeyringNamespaceAdapter;
  chainSeeds?: readonly ChainDefinitionSeed<RpcEndpoint>[];
};

export type NamespaceSignMessageInput = {
  chainRef: ChainRef;
  address: string;
  message: string;
};

export type NamespaceSignTypedDataInput = {
  chainRef: ChainRef;
  address: string;
  typedData: string;
};

export type NamespaceNativeBalanceInput = {
  chainRef: ChainRef;
  address: string;
};

export type NamespaceApprovalBindings = {
  signMessage(params: NamespaceSignMessageInput): Promise<string>;
  signTypedData(params: NamespaceSignTypedDataInput): Promise<string>;
};

export type NamespaceUiBindings = {
  getNativeBalance(params: NamespaceNativeBalanceInput): Promise<bigint>;
};

export type NamespaceApprovalService = NamespaceApprovalBindings;

export type NamespaceUiService = NamespaceUiBindings;

export type NamespaceRuntimeServices = Readonly<{
  approvals: NamespaceApprovalService;
  ui: NamespaceUiService;
}>;

export type NamespaceRuntimeManifest = {
  clientFactory: RpcClientFactory;
  createSigner(params: { accountSigning: AccountSigningService }): unknown;
  createApprovalBindings(params: { signer: unknown }): NamespaceApprovalBindings;
  createUiBindings(params: {
    rpcClients: Pick<ChainRpcClientPool, "getClient">;
    chains: ChainAddressingByNamespace;
  }): NamespaceUiBindings;
  createTransaction(params: {
    rpcClients: Pick<ChainRpcClientPool, "getClient">;
    chains: ChainAddressingByNamespace;
    signer: unknown;
  }): NamespaceTransaction;
  createTransactionAdapter(params: {
    rpcClients: Pick<ChainRpcClientPool, "getClient">;
    chains: ChainAddressingByNamespace;
    accounts: Readonly<Record<string, NamespaceAccountAddressing>>;
    accountSigning: AccountSigningService;
  }): TransactionNamespaceAdapter;
};

export type NamespaceManifest<TNamespace extends string = string> = {
  namespace: TNamespace;
  core: NamespaceCoreManifest<TNamespace>;
  runtime: NamespaceRuntimeManifest;
};

export const defineNamespaceManifest = <const TNamespace extends string>(
  manifest: NamespaceManifest<TNamespace>,
): NamespaceManifest<TNamespace> => manifest;
