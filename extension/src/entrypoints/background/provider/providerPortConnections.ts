import type { Runtime } from "webextension-polyfill";

export type ProviderConnectionScope = Readonly<{
  origin: string;
  namespace: string;
}>;

type ProviderConnectionScopeRelease = Readonly<{
  scope: ProviderConnectionScope;
  scopeBecameInactive: boolean;
}>;

export type ProviderPortConnectionChange = Readonly<{
  scope: ProviderConnectionScope;
  scopeBecameActive: boolean;
  previousScope: ProviderConnectionScopeRelease | null;
}>;

export const createProviderPortConnections = () => {
  const scopesByOrigin = new Map<string, Map<string, ProviderConnectionScope>>();
  const portsByOrigin = new Map<string, Map<string, Set<Runtime.Port>>>();
  const scopeByPort = new Map<Runtime.Port, ProviderConnectionScope>();

  const getPortsForScope = (scope: ProviderConnectionScope): Set<Runtime.Port> | undefined =>
    portsByOrigin.get(scope.origin)?.get(scope.namespace);

  const setScopeActive = (scope: ProviderConnectionScope, ports: Set<Runtime.Port>) => {
    let scopesByNamespace = scopesByOrigin.get(scope.origin);
    if (!scopesByNamespace) {
      scopesByNamespace = new Map();
      scopesByOrigin.set(scope.origin, scopesByNamespace);
    }
    scopesByNamespace.set(scope.namespace, scope);

    let portsByNamespace = portsByOrigin.get(scope.origin);
    if (!portsByNamespace) {
      portsByNamespace = new Map();
      portsByOrigin.set(scope.origin, portsByNamespace);
    }
    portsByNamespace.set(scope.namespace, ports);
  };

  const deleteScope = (scope: ProviderConnectionScope) => {
    const scopesByNamespace = scopesByOrigin.get(scope.origin);
    scopesByNamespace?.delete(scope.namespace);
    if (scopesByNamespace?.size === 0) {
      scopesByOrigin.delete(scope.origin);
    }

    const portsByNamespace = portsByOrigin.get(scope.origin);
    portsByNamespace?.delete(scope.namespace);
    if (portsByNamespace?.size === 0) {
      portsByOrigin.delete(scope.origin);
    }
  };

  const detachPort = (port: Runtime.Port): ProviderConnectionScopeRelease | null => {
    const scope = scopeByPort.get(port);
    if (!scope) {
      return null;
    }

    scopeByPort.delete(port);
    const members = getPortsForScope(scope);
    if (!members) {
      deleteScope(scope);
      return null;
    }

    members.delete(port);
    if (members.size > 0) {
      return {
        scope,
        scopeBecameInactive: false,
      };
    }

    deleteScope(scope);
    return {
      scope,
      scopeBecameInactive: true,
    };
  };

  const attachPortToConnection = (port: Runtime.Port, scope: ProviderConnectionScope): ProviderPortConnectionChange => {
    const previousScope = scopeByPort.get(port) ?? null;

    if (previousScope?.origin === scope.origin && previousScope.namespace === scope.namespace) {
      let members = getPortsForScope(scope);
      if (!members) {
        members = new Set();
      }
      members.add(port);
      setScopeActive(scope, members);
      scopeByPort.set(port, scope);

      return {
        scope,
        scopeBecameActive: false,
        previousScope: null,
      };
    }

    const previousScopeRelease = detachPort(port);
    let members = getPortsForScope(scope);
    const scopeBecameActive = !members || members.size === 0;
    if (!members) {
      members = new Set();
    }

    members.add(port);
    setScopeActive(scope, members);
    scopeByPort.set(port, scope);

    return {
      scope,
      scopeBecameActive,
      previousScope: previousScopeRelease,
    };
  };

  const listPortsForConnectionScopes = (scopes: Iterable<ProviderConnectionScope>) => {
    const ports = new Set<Runtime.Port>();

    for (const scope of scopes) {
      const members = getPortsForScope(scope);
      if (members) {
        for (const port of members) {
          ports.add(port);
        }
      }
    }

    return [...ports];
  };

  return {
    attachPortToConnection,
    detachPort,
    listPortsForConnectionScopes,
  };
};
