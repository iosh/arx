import { createEip155ProtocolAdapter } from "../../eip155ProtocolAdapter.js";
import { EIP155_NAMESPACE } from "../../handlers/namespaces/eip155/constants.js";
import { buildEip155Definitions } from "../../handlers/namespaces/eip155/definitions.js";
import { PASSTHROUGH_CONFIG } from "../../handlers/namespaces/eip155/passthrough.js";
import { createEip155RpcClientFactory } from "../../namespaceClients/eip155.js";
import type { RpcNamespaceModule } from "../types.js";

const eip155Adapter: RpcNamespaceModule["adapter"] = {
  namespace: EIP155_NAMESPACE,
  methodPrefixes: ["eth_", "personal_", "wallet_", "net_", "web3_"],
  definitions: buildEip155Definitions(),
  passthrough: PASSTHROUGH_CONFIG,
};

export const eip155Module: RpcNamespaceModule = {
  namespace: EIP155_NAMESPACE,
  adapter: eip155Adapter,
  protocolAdapter: createEip155ProtocolAdapter(),
  clientFactory: createEip155RpcClientFactory(),
};
