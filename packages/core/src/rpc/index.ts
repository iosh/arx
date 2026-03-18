import { RpcRegistry } from "./RpcRegistry.js";

export type {
  Json,
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  JsonRpcVersion2,
} from "@metamask/utils";
export type { RpcEncodedExecutionResult, RpcErrorEncoder, RpcSurfaceErrorContext } from "./errorEncoder.js";
export { createRpcErrorEncoder } from "./errorEncoder.js";
export { createRpcMethodExecutor } from "./executor.js";
export type { NamespaceAdapter } from "./handlers/namespaces/index.js";
export {
  createEip155Adapter,
  EIP155_NAMESPACE,
  EIP155_PASSTHROUGH_CONFIG,
  EIP155_PASSTHROUGH_FILTER_METHODS,
  EIP155_PASSTHROUGH_READONLY_METHODS,
} from "./handlers/namespaces/index.js";
export { namespaceFromContext } from "./handlers/namespaces/utils.js";
export type {
  HandlerControllers,
  HandlerRuntimeServices,
  MethodDefinition,
  Namespace,
  RpcInvocationContext,
  RpcRequest,
} from "./handlers/types.js";
export type { ResolvedRpcInvocation, ResolvedRpcInvocationDetails, RpcPassthroughAllowance } from "./invocation.js";
export {
  createRpcContextNamespaceResolver,
  createRpcMethodNamespaceResolver,
  resolveRpcInvocation,
  resolveRpcInvocationDetails,
} from "./invocation.js";
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
export type { RpcPassthroughPolicy } from "./RpcRegistry.js";
export { RpcRegistry } from "./RpcRegistry.js";
export type { RpcRequestClassification } from "./requestClassification.js";
export { RpcRequestClassifications } from "./requestClassification.js";
export { type RequestContext, RequestContextSchema } from "./requestContext.js";

export const createRpcRegistry = (): RpcRegistry => new RpcRegistry();
