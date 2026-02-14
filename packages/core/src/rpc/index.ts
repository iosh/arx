import { createEip155ProtocolAdapter } from "./eip155ProtocolAdapter.js";
import { createEip155Adapter, EIP155_NAMESPACE } from "./handlers/namespaces/index.js";
import { RpcRegistry } from "./RpcRegistry.js";

export type { NamespaceAdapter } from "./handlers/namespaces/index.js";
export { createEip155Adapter, EIP155_NAMESPACE } from "./handlers/namespaces/index.js";
export { namespaceFromContext } from "./handlers/namespaces/utils.js";
export type {
  HandlerControllers,
  MethodDefinition,
  Namespace,
  RpcInvocationContext,
  RpcRequest,
} from "./handlers/types.js";
export type { Eip155RpcCapabilities, Eip155RpcClient } from "./namespaceClients/eip155.js";
export { createEip155RpcClientFactory } from "./namespaceClients/eip155.js";
export * from "./permissions.js";

export {
  type RpcClient,
  type RpcClientFactory,
  RpcClientRegistry,
  type RpcClientRegistryOptions,
  type RpcTransport,
  type RpcTransportRequest,
} from "./RpcClientRegistry.js";
export type { ExecuteWithAdaptersContext, ExecuteWithAdaptersResult } from "./RpcRegistry.js";
export { RpcRegistry } from "./RpcRegistry.js";

export const DEFAULT_NAMESPACE = RpcRegistry.DEFAULT_NAMESPACE;

export const createRpcRegistry = (): RpcRegistry => new RpcRegistry();

export const registerBuiltinRpcAdapters = (registry: RpcRegistry): void => {
  // Namespace adapters
  if (!registry.getRegisteredNamespaceAdapters().some((entry) => entry.namespace === EIP155_NAMESPACE)) {
    registry.registerNamespaceAdapter(createEip155Adapter());
  }

  // Error protocol adapters
  registry.registerNamespaceProtocolAdapter(EIP155_NAMESPACE, createEip155ProtocolAdapter());
};
