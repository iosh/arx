import { createDefaultChainModuleRegistry } from "../../chains/registry.js";
import { EIP155_NAMESPACE } from "../../rpc/handlers/namespaces/utils.js";
import type { Eip155RpcCapabilities, Eip155RpcClient } from "../../rpc/namespaceClients/eip155.js";
import type { RpcClientRegistry } from "../../rpc/RpcClientRegistry.js";
import { createEip155TransactionAdapter } from "../../transactions/adapters/eip155/adapter.js";
import { createEip155Broadcaster } from "../../transactions/adapters/eip155/broadcaster.js";
import { createEip155Signer, type Eip155Signer } from "../../transactions/adapters/eip155/signer.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";

export const registerDefaultTransactionAdapters = (params: {
  transactionRegistry: TransactionAdapterRegistry;
  rpcClients: RpcClientRegistry;
  keyring: Parameters<typeof createEip155Signer>[0]["keyring"];
}): { signers: { eip155: Eip155Signer } } => {
  const { transactionRegistry, rpcClients, keyring } = params;

  const eip155Signer = createEip155Signer({ keyring });

  if (!transactionRegistry.get(EIP155_NAMESPACE)) {
    const rpcClientFactory = (chainRef: string) =>
      rpcClients.getClient<Eip155RpcCapabilities>("eip155", chainRef) as Eip155RpcClient;

    const broadcaster = createEip155Broadcaster({ rpcClientFactory });

    const adapter = createEip155TransactionAdapter({
      rpcClientFactory,
      signer: eip155Signer,
      broadcaster,
      chains: createDefaultChainModuleRegistry(),
    });

    transactionRegistry.register(EIP155_NAMESPACE, adapter);
  }

  return { signers: { eip155: eip155Signer } };
};
