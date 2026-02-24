import { BUILTIN_RPC_NAMESPACE_MODULES } from "./namespaces/builtin.js";
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
export { BUILTIN_RPC_NAMESPACE_MODULES } from "./namespaces/builtin.js";
export type { RpcNamespaceModule } from "./namespaces/types.js";
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
export { type RequestContext, RequestContextSchema } from "./requestContext.js";

export const DEFAULT_NAMESPACE = RpcRegistry.DEFAULT_NAMESPACE;

export const createRpcRegistry = (): RpcRegistry => new RpcRegistry();

export const registerBuiltinRpcAdapters = (registry: RpcRegistry): void => {
  const registered = new Set(registry.getRegisteredNamespaceAdapters().map((entry) => entry.namespace));

  for (const module of BUILTIN_RPC_NAMESPACE_MODULES) {
    if (!registered.has(module.namespace)) {
      registry.registerNamespaceAdapter(module.adapter);
      registered.add(module.namespace);
    }
    registry.registerNamespaceProtocolAdapter(module.namespace, module.protocolAdapter);
  }
};
