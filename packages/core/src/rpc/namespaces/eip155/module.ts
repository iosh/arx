import { createEip155ProtocolAdapter } from "../../eip155ProtocolAdapter.js";
import { createEip155Adapter } from "../../handlers/namespaces/eip155/index.js";
import { EIP155_NAMESPACE } from "../../handlers/namespaces/utils.js";
import { createEip155RpcClientFactory } from "../../namespaceClients/eip155.js";
import type { RpcNamespaceModule } from "../types.js";

export const eip155Module: RpcNamespaceModule = {
  namespace: EIP155_NAMESPACE,
  adapter: createEip155Adapter(),
  protocolAdapter: createEip155ProtocolAdapter(),
  clientFactory: createEip155RpcClientFactory(),
};
