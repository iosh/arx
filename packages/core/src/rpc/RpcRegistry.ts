import type { NamespaceProtocolAdapter } from "@arx/errors";
import { ArxReasons, arxError } from "@arx/errors";
import type { NamespaceAdapter } from "./handlers/namespaces/index.js";
import type { MethodDefinition, Namespace } from "./handlers/types.js";

type NamespaceDefinitions = Record<string, MethodDefinition>;

export type RpcPassthroughPolicy = {
  allowedMethods: ReadonlySet<string>;
  allowWhenLocked: ReadonlySet<string>;
};

export class RpcRegistry {
  private readonly namespaceDefinitions = new Map<Namespace, NamespaceDefinitions>();
  private readonly namespacePrefixes = new Map<string, Namespace>();
  private readonly namespaceAdapters = new Map<Namespace, NamespaceAdapter>();
  private readonly passthroughByNamespace = new Map<Namespace, RpcPassthroughPolicy>();
  private readonly protocolAdapters = new Map<string, NamespaceProtocolAdapter>();

  getRegisteredNamespaceAdapters(): NamespaceAdapter[] {
    return [...this.namespaceAdapters.values()];
  }

  registerNamespaceAdapter(adapter: NamespaceAdapter, options?: { replace?: boolean }): void {
    this.registerNamespaceDefinitions(adapter.namespace, adapter.definitions, {
      replace: options?.replace ?? true,
      methodPrefixes: adapter.methodPrefixes ?? [],
    });

    this.namespaceAdapters.set(adapter.namespace, adapter);

    if (adapter.passthrough) {
      const allowedMethods = new Set(adapter.passthrough.allowedMethods);
      const allowWhenLocked = new Set(adapter.passthrough.allowWhenLocked ?? []);

      for (const method of allowWhenLocked) {
        if (!allowedMethods.has(method)) {
          throw arxError({
            reason: ArxReasons.RpcInternal,
            message: `[rpc] invalid passthrough config for namespace "${adapter.namespace}": allowWhenLocked contains "${method}" but it is not listed in allowedMethods`,
            data: { namespace: adapter.namespace, method },
          });
        }
      }

      this.passthroughByNamespace.set(adapter.namespace, { allowedMethods, allowWhenLocked });
    } else {
      this.passthroughByNamespace.delete(adapter.namespace);
    }
  }

  unregisterNamespaceAdapter(namespace: Namespace): void {
    this.namespaceAdapters.delete(namespace);
    this.passthroughByNamespace.delete(namespace);
    this.unregisterNamespaceDefinitions(namespace);
  }

  registerNamespaceProtocolAdapter(namespace: string, adapter: NamespaceProtocolAdapter): void {
    if (!namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: '[rpc] registerNamespaceProtocolAdapter requires a non-empty "namespace"',
      });
    }
    this.protocolAdapters.set(namespace, adapter);
  }

  getNamespaceProtocolAdapter(namespace: string): NamespaceProtocolAdapter {
    if (!namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: '[rpc] getNamespaceProtocolAdapter requires a non-empty "namespace"',
      });
    }

    const direct = this.protocolAdapters.get(namespace);
    if (direct) return direct;

    const [prefix] = namespace.split(":");
    if (prefix) {
      const byPrefix = this.protocolAdapters.get(prefix);
      if (byPrefix) return byPrefix;
    }

    throw arxError({
      reason: ArxReasons.RpcInternal,
      message: `[rpc] protocol adapter not registered for namespace "${namespace}"`,
      data: { namespace },
    });
  }

  private cloneDefinitions(definitions: NamespaceDefinitions): NamespaceDefinitions {
    return { ...definitions };
  }

  registerNamespaceDefinitions(
    namespace: Namespace,
    definitions: NamespaceDefinitions,
    options?: { replace?: boolean; methodPrefixes?: string[] },
  ): void {
    const existing = this.namespaceDefinitions.get(namespace);
    const shouldReplace = options?.replace ?? true;
    const next = shouldReplace || !existing ? this.cloneDefinitions(definitions) : { ...existing, ...definitions };

    this.namespaceDefinitions.set(namespace, next);
    this.recordPrefixesForNamespace(namespace, options?.methodPrefixes);
  }

  unregisterNamespaceDefinitions(namespace: Namespace): void {
    this.namespaceDefinitions.delete(namespace);

    for (const [prefix, currentNamespace] of this.namespacePrefixes) {
      if (currentNamespace === namespace) {
        this.namespacePrefixes.delete(prefix);
      }
    }
  }

  getRegisteredNamespaces(): Namespace[] {
    return [...this.namespaceDefinitions.keys()];
  }

  hasNamespace(namespace: Namespace): boolean {
    return this.namespaceDefinitions.has(namespace);
  }

  getMethodDefinition(namespace: Namespace, method: string): MethodDefinition | undefined {
    return this.namespaceDefinitions.get(namespace)?.[method];
  }

  resolveNamespaceFromMethodPrefix(method: string): Namespace | null {
    for (const [prefix, namespace] of this.namespacePrefixes) {
      if (method.startsWith(prefix)) {
        return namespace;
      }
    }

    return null;
  }

  getPassthroughPolicy(namespace: Namespace): RpcPassthroughPolicy | null {
    return this.passthroughByNamespace.get(namespace) ?? null;
  }

  private recordPrefixesForNamespace(namespace: Namespace, prefixes?: string[] | undefined) {
    if (!prefixes || prefixes.length === 0) {
      return;
    }

    for (const [prefix, currentNamespace] of this.namespacePrefixes) {
      if (currentNamespace === namespace) {
        this.namespacePrefixes.delete(prefix);
      }
    }

    for (const prefix of prefixes) {
      if (!prefix) continue;

      const existing = this.namespacePrefixes.get(prefix);
      if (existing && existing !== namespace) {
        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: `[rpc] method prefix "${prefix}" already registered for namespace "${existing}"`,
          data: { prefix, existingNamespace: existing, namespace },
        });
      }

      this.namespacePrefixes.set(prefix, namespace);
    }
  }
}
