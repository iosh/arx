import type { NamespaceProtocolAdapter } from "@arx/errors";

const namespaceProtocolAdapters = new Map<string, NamespaceProtocolAdapter>();

export const registerNamespaceProtocolAdapter = (namespace: string, adapter: NamespaceProtocolAdapter): void => {
  if (!namespace) throw new Error('[rpc] registerNamespaceProtocolAdapter requires a non-empty "namespace"');
  namespaceProtocolAdapters.set(namespace, adapter);
};

const resolveKey = (namespace: string): string | null => {
  if (namespaceProtocolAdapters.has(namespace)) return namespace;

  const [prefix] = namespace.split(":");
  if (prefix && namespaceProtocolAdapters.has(prefix)) return prefix;

  return null;
};

export const getNamespaceProtocolAdapter = (namespace: string): NamespaceProtocolAdapter => {
  if (!namespace) throw new Error('[rpc] getNamespaceProtocolAdapter requires a non-empty "namespace"');

  const key = resolveKey(namespace);
  if (!key) {
    throw new Error(`[rpc] protocol adapter not registered for namespace "${namespace}"`);
  }

  return namespaceProtocolAdapters.get(key)!;
};
