import type {
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

const cloneState = (state: PermissionsState): PermissionsState => ({
  origins: Object.fromEntries(Object.entries(state.origins).map(([origin, scopes]) => [origin, [...scopes]])),
});

const isSameScopes = (prev: PermissionScope[], next: PermissionScope[]) => {
  if (prev.length !== next.length) {
    return false;
  }
  return prev.every((scope, index) => scope === next[index]);
};

const isSameState = (prev?: PermissionsState, next?: PermissionsState) => {
  if (!prev || !next) {
    return false;
  }

  const prevOrigins = Object.keys(prev.origins);
  const nextOrigins = Object.keys(next.origins);

  if (prevOrigins.length !== nextOrigins.length) {
    return false;
  }

  return prevOrigins.every((origin) => {
    const prevScopes = prev.origins[origin] ?? [];
    const nextScopes = next.origins[origin] ?? [];
    return isSameScopes(prevScopes, nextScopes);
  });
};

const resolveScopes = (state: PermissionsState, origin: string): PermissionScope[] => {
  return state.origins[origin] ? [...state.origins[origin]] : [];
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

  async ensurePermission(origin: string, method: string): Promise<void> {
    const scope = this.#scopeResolver(method);
    if (!scope) {
      return;
    }

    const scopes = resolveScopes(this.#state, origin);
    if (!scopes.includes(scope)) {
      throw new Error(`Origin "${origin}" lacks scope "${scope}"`);
    }
  }

  async grant(origin: string, scope: PermissionScope): Promise<void> {
    const currentScopes = resolveScopes(this.#state, origin);
    if (currentScopes.includes(scope)) {
      return;
    }

    const nextScopes = [...currentScopes, scope];

    const nextState: PermissionsState = {
      origins: {
        ...this.#state.origins,
        [origin]: nextScopes,
      },
    };

    this.#state = cloneState(nextState);
    this.#publishState();
    this.#publishOrigin({
      origin,
      scopes: nextScopes,
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
      scopes: [],
    });
  }

  onPermissionsChanged(handler: (state: PermissionsState) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_STATE_TOPIC, handler);
  }
  onOriginPermissionsChanged(handler: (payload: OriginPermissions) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_ORIGIN_TOPIC, handler);
  }

  #publishState() {
    this.#messenger.publish(PERMISSION_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #publishOrigin(payload: OriginPermissions) {
    this.#messenger.publish(
      PERMISSION_ORIGIN_TOPIC,
      { origin: payload.origin, scopes: [...payload.scopes] },
      {
        compare: (prev, next) => {
          if (!prev || !next) {
            return false;
          }
          return prev.origin === next.origin && isSameScopes(prev.scopes, next.scopes);
        },
      },
    );
  }
}
