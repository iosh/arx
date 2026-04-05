import type { Runtime } from "webextension-polyfill";

export type ProviderBinding = Readonly<{
  origin: string;
  namespace: string;
}>;

type ProviderBindingTransition = Readonly<{
  binding: ProviderBinding;
  bindingBecameInactive: boolean;
}>;

export type ProviderBindingMutation = Readonly<{
  binding: ProviderBinding;
  bindingBecameActive: boolean;
  previousBinding: ProviderBindingTransition | null;
  changed: boolean;
}>;

const buildBindingKey = ({ origin, namespace }: ProviderBinding) => JSON.stringify([origin, namespace]);

const sortBindings = (bindings: Iterable<ProviderBinding>) => {
  return [...bindings].sort(
    (left, right) => left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace),
  );
};

export const createProviderBindingRegistry = () => {
  const bindingFacts = new Map<string, ProviderBinding>();
  const portsByBinding = new Map<string, Set<Runtime.Port>>();
  const bindingKeyByPort = new Map<Runtime.Port, string>();

  const readBindingForPort = (port: Runtime.Port): ProviderBinding | null => {
    const bindingKey = bindingKeyByPort.get(port);
    if (!bindingKey) {
      return null;
    }

    return bindingFacts.get(bindingKey) ?? null;
  };

  const releasePort = (port: Runtime.Port): ProviderBindingTransition | null => {
    const bindingKey = bindingKeyByPort.get(port);
    if (!bindingKey) {
      return null;
    }

    bindingKeyByPort.delete(port);
    const members = portsByBinding.get(bindingKey);
    if (!members) {
      bindingFacts.delete(bindingKey);
      return null;
    }

    members.delete(port);
    const binding = bindingFacts.get(bindingKey);
    if (!binding) {
      if (members.size === 0) {
        portsByBinding.delete(bindingKey);
      }
      return null;
    }

    if (members.size > 0) {
      return {
        binding,
        bindingBecameInactive: false,
      };
    }

    portsByBinding.delete(bindingKey);
    bindingFacts.delete(bindingKey);
    return {
      binding,
      bindingBecameInactive: true,
    };
  };

  const bindPort = (port: Runtime.Port, binding: ProviderBinding): ProviderBindingMutation => {
    const nextBindingKey = buildBindingKey(binding);
    const previousBindingKey = bindingKeyByPort.get(port) ?? null;

    if (previousBindingKey === nextBindingKey) {
      let members = portsByBinding.get(nextBindingKey);
      if (!members) {
        members = new Set();
        portsByBinding.set(nextBindingKey, members);
      }
      members.add(port);
      bindingFacts.set(nextBindingKey, binding);
      bindingKeyByPort.set(port, nextBindingKey);

      return {
        binding,
        bindingBecameActive: false,
        previousBinding: null,
        changed: false,
      };
    }

    const previousBinding = releasePort(port);
    let members = portsByBinding.get(nextBindingKey);
    const bindingBecameActive = !members || members.size === 0;
    if (!members) {
      members = new Set();
      portsByBinding.set(nextBindingKey, members);
    }

    members.add(port);
    bindingFacts.set(nextBindingKey, binding);
    bindingKeyByPort.set(port, nextBindingKey);

    return {
      binding,
      bindingBecameActive,
      previousBinding,
      changed: true,
    };
  };

  const listActiveBindings = () => {
    return sortBindings(bindingFacts.values());
  };

  const listBindingsForNamespaces = (namespaces: Iterable<string>) => {
    const allowed = new Set(namespaces);
    return sortBindings([...bindingFacts.values()].filter((binding) => allowed.has(binding.namespace)));
  };

  const listActiveNamespaces = () => {
    return [...new Set(bindingFacts.values().map((binding) => binding.namespace))].sort((left, right) =>
      left.localeCompare(right),
    );
  };

  const listPortsBoundToNamespaces = (namespaces: Iterable<string>) => {
    const allowed = new Set(namespaces);
    const ports = new Set<Runtime.Port>();

    for (const [bindingKey, members] of portsByBinding) {
      const binding = bindingFacts.get(bindingKey);
      if (!binding || !allowed.has(binding.namespace)) {
        continue;
      }

      for (const port of members) {
        ports.add(port);
      }
    }

    return [...ports];
  };

  const clearAllState = () => {
    bindingFacts.clear();
    portsByBinding.clear();
    bindingKeyByPort.clear();
  };

  return {
    bindPort,
    releasePort,
    readBindingForPort,
    listActiveBindings,
    listBindingsForNamespaces,
    listActiveNamespaces,
    listPortsBoundToNamespaces,
    clearAllState,
  };
};
