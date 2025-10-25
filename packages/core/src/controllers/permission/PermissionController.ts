import type { ChainNamespace } from "../account/types.js";
import type {
  GrantPermissionOptions,
  NamespacePermissionState,
  OriginPermissionState,
  OriginPermissions,
  PermissionController,
  PermissionControllerOptions,
  PermissionMessenger,
  PermissionScope,
  PermissionScopeResolver,
  PermissionsState,
} from "./types.js";

const PERMISSION_STATE_TOPIC = "permission:stateChanged";
const PERMISSION_ORIGIN_TOPIC = "permission:originChanged";

const DEFAULT_PERMISSION_NAMESPACE: ChainNamespace = "eip155";

const cloneNamespaceState = (state: NamespacePermissionState): NamespacePermissionState => ({
  scopes: [...state.scopes],
  chains: [...state.chains],
});

const cloneOriginState = (state: OriginPermissionState): OriginPermissionState =>
  Object.fromEntries(
    Object.entries(state).map(([namespace, namespaceState]) => [namespace, cloneNamespaceState(namespaceState)]),
  );

const cloneState = (state: PermissionsState): PermissionsState => ({
  origins: Object.fromEntries(
    Object.entries(state.origins).map(([origin, originState]) => [origin, cloneOriginState(originState)]),
  ),
});

const isSameList = (prev: readonly string[], next: readonly string[]) => {
  return prev.length === next.length && prev.every((value, index) => value === next[index]);
};

const isSameNamespaceState = (prev: NamespacePermissionState, next: NamespacePermissionState) => {
  return isSameList(prev.scopes, next.scopes) && isSameList(prev.chains, next.chains);
};

const isSameOriginState = (prev: OriginPermissionState, next: OriginPermissionState) => {
  const prevNamespaces = Object.keys(prev);
  const nextNamespaces = Object.keys(next);
  if (prevNamespaces.length !== nextNamespaces.length) return false;

  return prevNamespaces.every((namespace) => {
    const prevState = prev[namespace];
    const nextState = next[namespace];
    if (!prevState || !nextState) return false;
    return isSameNamespaceState(prevState, nextState);
  });
};

const isSameState = (prev?: PermissionsState, next?: PermissionsState) => {
  if (!prev || !next) return false;

  const prevOrigins = Object.keys(prev.origins);
  const nextOrigins = Object.keys(next.origins);
  if (prevOrigins.length !== nextOrigins.length) return false;

  return prevOrigins.every((origin) => {
    const prevOriginState = prev.origins[origin];
    const nextOriginState = next.origins[origin];
    if (!prevOriginState || !nextOriginState) return false;
    return isSameOriginState(prevOriginState, nextOriginState);
  });
};

const resolveNamespaceFromContext = (context?: Parameters<PermissionScopeResolver>[1]): ChainNamespace => {
  if (context?.namespace) return context.namespace as ChainNamespace;
  if (context?.chainRef) {
    const [namespace] = context.chainRef.split(":");
    if (namespace) return namespace as ChainNamespace;
  }
  return DEFAULT_PERMISSION_NAMESPACE;
};

const resolveNamespaceFromOptions = (options?: GrantPermissionOptions): ChainNamespace => {
  if (options?.namespace) return options.namespace;
  if (options?.chainRef) {
    const [namespace] = options.chainRef.split(":");
    if (namespace) return namespace as ChainNamespace;
  }
  return DEFAULT_PERMISSION_NAMESPACE;
};
const resolveScopes = (state: PermissionsState, origin: string, namespace: ChainNamespace): PermissionScope[] => {
  const originState = state.origins[origin];
  if (!originState) return [];
  const namespaceState = originState[namespace];
  return namespaceState ? [...namespaceState.scopes] : [];
};

export class InMemoryPermissionController implements PermissionController {
  #messenger: PermissionMessenger;
  #scopeResolver: PermissionScopeResolver;
  #state: PermissionsState;

  constructor({ messenger, scopeResolver, initialState }: PermissionControllerOptions) {
    this.#messenger = messenger;
    this.#scopeResolver = scopeResolver;
    this.#state = cloneState(initialState ?? { origins: {} });
    this.#publishState();
  }

  getState(): PermissionsState {
    return cloneState(this.#state);
  }

  async ensurePermission(
    origin: string,
    method: string,
    context?: Parameters<PermissionScopeResolver>[1],
  ): Promise<void> {
    const scope = this.#scopeResolver(method, context);
    if (!scope) return;

    const namespace = resolveNamespaceFromContext(context);
    const scopes = resolveScopes(this.#state, origin, namespace);
    if (!scopes.includes(scope)) {
      throw new Error(`Origin "${origin}" lacks scope "${scope}" for namespace "${namespace}"`);
    }
  }

  async grant(origin: string, scope: PermissionScope, options?: GrantPermissionOptions): Promise<void> {
    const namespace = resolveNamespaceFromOptions(options);
    const chainRef = options?.chainRef ?? null;

    const currentOrigin = this.#state.origins[origin] ?? {};
    const currentNamespace = currentOrigin[namespace] ?? { scopes: [], chains: [] };

    const hasScope = currentNamespace.scopes.includes(scope);
    const hasChain = chainRef ? currentNamespace.chains.includes(chainRef) : false;

    if (hasScope && (!chainRef || hasChain)) {
      return;
    }

    const nextNamespace: NamespacePermissionState = {
      scopes: hasScope ? [...currentNamespace.scopes] : [...currentNamespace.scopes, scope],
      chains: chainRef && !hasChain ? [...currentNamespace.chains, chainRef] : [...currentNamespace.chains],
    };

    const nextOrigin: OriginPermissionState = {
      ...currentOrigin,
      [namespace]: nextNamespace,
    };

    const nextState: PermissionsState = {
      origins: {
        ...this.#state.origins,
        [origin]: nextOrigin,
      },
    };

    this.#state = cloneState(nextState);
    this.#publishState();
    this.#publishOrigin({
      origin,
      namespaces: cloneOriginState(nextOrigin),
    });
  }
  async clear(origin: string): Promise<void> {
    if (!this.#state.origins[origin]) {
      return;
    }

    const { [origin]: _removed, ...rest } = this.#state.origins;
    this.#state = cloneState({ origins: rest });

    this.#publishState();
    this.#publishOrigin({
      origin,
      namespaces: {},
    });
  }

  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_STATE_TOPIC, handler);
  }
  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_ORIGIN_TOPIC, handler);
  }

  replaceState(state: PermissionsState): void {
    if (isSameState(this.#state, state)) {
      return;
    }

    this.#state = cloneState(state);
    this.#publishState();
  }

  #publishState() {
    this.#messenger.publish(PERMISSION_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #publishOrigin(payload: OriginPermissions) {
    this.#messenger.publish(
      PERMISSION_ORIGIN_TOPIC,
      { origin: payload.origin, namespaces: cloneOriginState(payload.namespaces) },
      {
        compare: (prev, next) => {
          if (!prev || !next) return false;
          return prev.origin === next.origin && isSameOriginState(prev.namespaces, next.namespaces);
        },
      },
    );
  }
}
