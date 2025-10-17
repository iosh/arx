import type { Caip2ChainId } from "../chains/ids.js";
import type { PermissionScope, PermissionScopeResolver } from "../controllers/index.js";
import { buildEip155Definitions, EIP155_NAMESPACE } from "./handlers/namespaces/index.js";
import type { HandlerControllers, MethodDefinition, Namespace, RpcRequest } from "./handlers/types.js";

export const createMethodDefinitionResolver = (controllers: HandlerControllers) => {
  return (method: string) => {
    const namespace = resolveNamespace(controllers);
    return DEFINITIONS_BY_NAMESPACE[namespace]?.[method];
  };
};

export type MethodHandler = (context: {
  origin: string;
  request: RpcRequest;
  controllers: HandlerControllers;
}) => Promise<unknown> | unknown;

const DEFINITIONS_BY_NAMESPACE: Record<Namespace, Record<string, MethodDefinition>> = {
  [EIP155_NAMESPACE]: buildEip155Definitions(),
};

const resolveNamespace = (controllers: HandlerControllers): Namespace => {
  const activeChain = controllers.network.getActiveChain();
  const [namespace] = activeChain.chainRef.split(":");
  return namespace ?? "eip155";
};

export const createPermissionScopeResolver = (
  namespaceResolver: () => Namespace,
  overrides?: Partial<Record<string, PermissionScope | null>>,
): PermissionScopeResolver => {
  return (method) => {
    if (overrides && Object.hasOwn(overrides, method)) {
      const value = overrides[method];
      return value === null ? undefined : value;
    }
    const namespace = namespaceResolver();
    return DEFINITIONS_BY_NAMESPACE[namespace]?.[method]?.scope;
  };
};

export const createMethodExecutor =
  (controllers: HandlerControllers) =>
  async ({ origin, request }: { origin: string; request: RpcRequest }) => {
    const namespace = resolveNamespace(controllers);
    const definition = DEFINITIONS_BY_NAMESPACE[namespace]?.[request.method];
    if (!definition) {
      throw new Error(`Method "${request.method}" not implemented for namespace "${namespace}"`);
    }
    return definition.handler({ origin, request, controllers });
  };

export type DomainChainService = {
  setDomainChain(origin: string, caip2: Caip2ChainId): Promise<void>;
  getDomainChain(origin: string): Promise<Caip2ChainId | null>;
};

export const createDomainChainService = (): DomainChainService => ({
  async setDomainChain() {
    throw new Error("Not implemented yet");
  },
  async getDomainChain() {
    throw new Error("Not implemented yet");
  },
});
