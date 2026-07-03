import { RpcInternalError } from "./errors.js";
import type { NamespaceAdapter } from "./handlers/namespaces/index.js";
import type { MethodDefinition, Namespace } from "./handlers/types.js";

type NamespaceDefinitions = Readonly<Record<string, MethodDefinition>>;

export type RpcPassthroughPolicy = Readonly<{
  allowedMethods: ReadonlySet<string>;
  allowWhenLocked: ReadonlySet<string>;
}>;

export type RpcNamespaceRoute = Readonly<{
  definitions: NamespaceDefinitions;
  passthrough: RpcPassthroughPolicy | null;
}>;

export type RpcMethodPrefixRoute = Readonly<{
  prefix: string;
  namespace: Namespace;
}>;

export type RpcRouting = Readonly<{
  namespaces: Readonly<Record<Namespace, RpcNamespaceRoute>>;
  methodPrefixes: readonly RpcMethodPrefixRoute[];
}>;

const buildPassthroughPolicy = (adapter: NamespaceAdapter): RpcPassthroughPolicy | null => {
  if (!adapter.passthrough) {
    return null;
  }

  const allowedMethods = new Set(adapter.passthrough.allowedMethods);
  const allowWhenLocked = new Set(adapter.passthrough.allowWhenLocked ?? []);

  for (const method of allowWhenLocked) {
    if (!allowedMethods.has(method)) {
      throw new RpcInternalError({
        message: `[rpc] invalid passthrough config for namespace "${adapter.namespace}": allowWhenLocked contains "${method}" but it is not listed in allowedMethods`,
      });
    }
  }

  return { allowedMethods, allowWhenLocked };
};

export const buildRpcRouting = (adapters: readonly NamespaceAdapter[]): RpcRouting => {
  const namespaces: Record<Namespace, RpcNamespaceRoute> = {};
  const methodPrefixes: RpcMethodPrefixRoute[] = [];
  const prefixOwnerByPrefix = new Map<string, Namespace>();

  for (const adapter of adapters) {
    if (namespaces[adapter.namespace]) {
      throw new RpcInternalError({
        message: `[rpc] namespace "${adapter.namespace}" is already registered`,
      });
    }

    namespaces[adapter.namespace] = {
      definitions: { ...adapter.definitions },
      passthrough: buildPassthroughPolicy(adapter),
    };

    for (const prefix of adapter.methodPrefixes ?? []) {
      if (!prefix) {
        continue;
      }

      const existing = prefixOwnerByPrefix.get(prefix);
      if (existing && existing !== adapter.namespace) {
        throw new RpcInternalError({
          message: `[rpc] method prefix "${prefix}" already registered for namespace "${existing}"`,
        });
      }

      if (!existing) {
        prefixOwnerByPrefix.set(prefix, adapter.namespace);
        methodPrefixes.push({ prefix, namespace: adapter.namespace });
      }
    }
  }

  return {
    namespaces,
    methodPrefixes,
  };
};

export const listRpcNamespaces = (routing: RpcRouting): Namespace[] => Object.keys(routing.namespaces);

export const hasRpcNamespace = (routing: RpcRouting, namespace: Namespace): boolean =>
  Object.hasOwn(routing.namespaces, namespace);

export const findRpcMethodDefinition = (
  routing: RpcRouting,
  namespace: Namespace,
  method: string,
): MethodDefinition | undefined => routing.namespaces[namespace]?.definitions[method];

export const resolveRpcNamespaceFromMethod = (routing: RpcRouting, method: string): Namespace | null => {
  for (const { prefix, namespace } of routing.methodPrefixes) {
    if (method.startsWith(prefix)) {
      return namespace;
    }
  }

  return null;
};

export const rpcPassthroughPolicyForNamespace = (
  routing: RpcRouting,
  namespace: Namespace,
): RpcPassthroughPolicy | null => routing.namespaces[namespace]?.passthrough ?? null;
