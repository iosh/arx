import { type PermissionScope, type PermissionScopeResolver, PermissionScopes } from "../controllers/index.js";
import { buildEip155Definitions, EIP155_NAMESPACE } from "./handlers/namespaces/eip155.js";
import type { HandlerControllers, MethodDefinition, Namespace, RpcRequest } from "./handlers/types.js";

export type MethodHandler = (context: {
  origin: string;
  request: RpcRequest;
  controllers: HandlerControllers;
}) => Promise<unknown> | unknown;

const DEFINITIONS_BY_NAMESPACE: Record<Namespace, Record<string, MethodDefinition>> = {
  [EIP155_NAMESPACE]: buildEip155Definitions(),
};

const resolveNamespace = (controllers: HandlerControllers): Namespace => {
  const active = controllers.network.getState().active;
  const [namespace] = active.caip2.split(":");
  return namespace ?? "eip155";
};

export const createPermissionScopeResolver = (
  overrides?: Partial<Record<string, PermissionScope | null>>,
): PermissionScopeResolver => {
  return (method) => {
    if (overrides && Object.hasOwn(overrides, method)) {
      const value = overrides[method];
      return value === null ? undefined : value;
    }
    return DEFINITIONS_BY_NAMESPACE[EIP155_NAMESPACE]?.[method]?.scope;
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
