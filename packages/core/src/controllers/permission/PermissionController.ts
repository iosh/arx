import type { Caip2ChainId } from "../../chains/ids.js";
import { type ChainModuleRegistry, createDefaultChainModuleRegistry } from "../../chains/registry.js";
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
  ...(state.accountsByChain
    ? {
        accountsByChain: Object.fromEntries(
          Object.entries(state.accountsByChain).map(([chainRef, accounts]) => [chainRef, [...accounts]]),
        ),
      }
    : {}),
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
  if (!isSameList(prev.scopes, next.scopes) || !isSameList(prev.chains, next.chains)) return false;

  const prevMap = prev.accountsByChain;
  const nextMap = next.accountsByChain;
  if (!prevMap && !nextMap) return true;
  if (!prevMap || !nextMap) return false;

  const prevKeys = Object.keys(prevMap).sort();
  const nextKeys = Object.keys(nextMap).sort();
  if (!isSameList(prevKeys, nextKeys)) return false;

  return prevKeys.every((key) => {
    const prevAccounts = prevMap[key as keyof typeof prevMap] ?? [];
    const nextAccounts = nextMap[key as keyof typeof nextMap] ?? [];
    return isSameList(prevAccounts, nextAccounts);
  });
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

type ParsedChainRef = {
  namespace: ChainNamespace;
  value: string;
};

const parseChainRef = (chainRef: string | null | undefined): ParsedChainRef | null => {
  if (!chainRef || typeof chainRef !== "string") return null;
  const [namespace, reference] = chainRef.split(":");
  if (!namespace || !reference) return null;
  return {
    namespace: namespace as ChainNamespace,
    value: `${namespace}:${reference}`,
  };
};

const resolveNamespaceFromContext = (context?: Parameters<PermissionScopeResolver>[1]): ChainNamespace => {
  if (context?.namespace) return context.namespace as ChainNamespace;
  const parsed = parseChainRef(context?.chainRef ?? null);
  return parsed?.namespace ?? DEFAULT_PERMISSION_NAMESPACE;
};

const resolveNamespaceFromOptions = (options: {
  namespace?: ChainNamespace | null;
  chainRef: Caip2ChainId;
}): { namespace: ChainNamespace; chainRef: Caip2ChainId } => {
  const parsed = parseChainRef(options.chainRef);
  const namespace = (options.namespace ?? parsed?.namespace ?? DEFAULT_PERMISSION_NAMESPACE) as ChainNamespace;
  const normalized = (parsed?.value ?? options.chainRef) as Caip2ChainId;

  if (options.namespace && parsed && parsed.namespace !== options.namespace) {
    throw new Error(
      `Permission namespace mismatch: chainRef "${parsed.value}" belongs to namespace "${parsed.namespace}" but
  "${options.namespace}" was provided`,
    );
  }

  return { namespace, chainRef: normalized };
};

const resolveNamespaceState = (
  state: PermissionsState,
  origin: string,
  namespace: ChainNamespace,
): NamespacePermissionState | undefined => {
  return state.origins[origin]?.[namespace];
};

export class InMemoryPermissionController implements PermissionController {
  #messenger: PermissionMessenger;
  #scopeResolver: PermissionScopeResolver;
  #state: PermissionsState;
  #chains: ChainModuleRegistry;

  constructor({ messenger, scopeResolver, initialState }: PermissionControllerOptions) {
    this.#messenger = messenger;
    this.#scopeResolver = scopeResolver;
    this.#chains = createDefaultChainModuleRegistry();
    this.#state = cloneState(initialState ?? { origins: {} });
    this.#publishState();
  }

  getState(): PermissionsState {
    return cloneState(this.#state);
  }

  getPermittedAccounts(
    origin: string,
    options: { namespace?: ChainNamespace | null; chainRef: Caip2ChainId },
  ): string[] {
    const { namespace, chainRef } = resolveNamespaceFromOptions(options);
    const namespaceState = resolveNamespaceState(this.#state, origin, namespace);
    const accounts = namespaceState?.accountsByChain?.[chainRef] ?? [];
    return [...accounts];
  }

  isConnected(origin: string, options: { namespace?: ChainNamespace | null; chainRef: Caip2ChainId }): boolean {
    const { namespace, chainRef } = resolveNamespaceFromOptions(options);
    const namespaceState = resolveNamespaceState(this.#state, origin, namespace);
    return namespaceState?.accountsByChain?.[chainRef] !== undefined;
  }

  async setPermittedAccounts(
    origin: string,
    options: { namespace?: ChainNamespace | null; chainRef: Caip2ChainId; accounts: string[] },
  ): Promise<void> {
    const { namespace, chainRef } = resolveNamespaceFromOptions(options);

    const seen = new Set<string>();
    const uniqueAccounts: string[] = [];

    for (const raw of options.accounts) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const canonical =
        namespace === "eip155" ? this.#chains.normalizeAddress({ chainRef, value: trimmed }).canonical : trimmed;

      if (seen.has(canonical)) continue;
      seen.add(canonical);
      uniqueAccounts.push(canonical);
    }

    const currentOrigin = this.#state.origins[origin] ?? {};
    const currentNamespace = currentOrigin[namespace] ?? { scopes: [], chains: [] };

    const prev = currentNamespace.accountsByChain?.[chainRef];
    if (prev && isSameList(prev, uniqueAccounts)) {
      return;
    }

    const nextNamespace = cloneNamespaceState(currentNamespace);
    const nextAccountsByChain = { ...(nextNamespace.accountsByChain ?? {}) };
    nextAccountsByChain[chainRef] = uniqueAccounts;

    const nextOrigin: OriginPermissionState = {
      ...currentOrigin,
      [namespace]: {
        ...nextNamespace,
        accountsByChain: nextAccountsByChain,
      },
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
  async assertPermission(
    origin: string,
    method: string,
    context?: Parameters<PermissionScopeResolver>[1],
  ): Promise<void> {
    const scope = this.#scopeResolver(method, context);
    if (!scope) return;

    const namespace = resolveNamespaceFromContext(context);
    const namespaceState = resolveNamespaceState(this.#state, origin, namespace);
    const scopes = namespaceState?.scopes ?? [];

    if (!scopes.includes(scope)) {
      throw new Error(`Origin "${origin}" lacks scope "${scope}" for namespace "${namespace}"`);
    }

    const parsedChain = parseChainRef(context?.chainRef ?? null);
    const permittedChains = namespaceState?.chains ?? [];
    if (parsedChain && !permittedChains.includes(parsedChain.value)) {
      throw new Error(
        `Origin "${origin}" lacks chain permission for "${parsedChain.value}" in namespace "${namespace}"`,
      );
    }
  }

  async grant(origin: string, scope: PermissionScope, options?: GrantPermissionOptions): Promise<void> {
    const parsedChain = parseChainRef(options?.chainRef ?? null);
    const namespace = options?.namespace ?? parsedChain?.namespace ?? DEFAULT_PERMISSION_NAMESPACE;
    const normalizedChainRef = parsedChain?.value ?? null;

    if (options?.namespace && parsedChain && parsedChain.namespace !== options.namespace) {
      throw new Error(
        `Grant namespace mismatch: chainRef "${parsedChain.value}" belongs to namespace "${parsedChain.namespace}" but "${options.namespace}" was provided`,
      );
    }

    const currentOrigin = this.#state.origins[origin] ?? {};
    const currentNamespace = currentOrigin[namespace] ?? { scopes: [], chains: [] };

    const hasScope = currentNamespace.scopes.includes(scope);
    const hasChain = normalizedChainRef ? currentNamespace.chains.includes(normalizedChainRef) : false;

    if (hasScope && (!normalizedChainRef || hasChain)) {
      return;
    }

    const nextNamespace = cloneNamespaceState(currentNamespace);
    if (!hasScope) {
      nextNamespace.scopes.push(scope);
    }
    if (normalizedChainRef && !hasChain) {
      nextNamespace.chains.push(normalizedChainRef);
    }

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

  getPermissions(origin: string): OriginPermissionState | undefined {
    const namespaces = this.#state.origins[origin];
    return namespaces ? cloneOriginState(namespaces) : undefined;
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
