import type { ProviderModule, ProviderModuleInstance } from "../modules.js";
import type { Transport } from "../types/index.js";
import { createEip6963Bridge, type Eip6963Bridge } from "./eip6963Bridge.js";

type ProviderHostLogger = Readonly<{
  debug?: (message: string, meta?: unknown) => void;
}>;

// NOTE: TypeScript's lib.dom does not model Event/CustomEvent as properties on Window, but they exist at runtime per-realm.
// We use constructors from the provided targetWindow to ensure events are created in the correct realm (e.g. JSDOM/iframes).
export type ProviderHostWindow = Window & {
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
};

export type ProviderHostOptions = {
  targetWindow: ProviderHostWindow;
  createTransportForNamespace: (namespace: string) => Transport;
  modules: readonly ProviderModule[];
  logger?: ProviderHostLogger;
};

type ProviderCacheEntry = Readonly<{
  module: ProviderModule;
  entry: ProviderModuleInstance;
}>;

const indexProviderModules = (modules: readonly ProviderModule[]) => {
  const byNamespace = new Map<string, ProviderModule>();

  for (const module of modules) {
    if (byNamespace.has(module.namespace)) {
      throw new Error(`Duplicate provider module namespace "${module.namespace}"`);
    }

    byNamespace.set(module.namespace, module);
  }

  return byNamespace;
};

const assertUniqueModuleInjectionBindings = (modules: readonly ProviderModule[]) => {
  const windowKeyOwners = new Map<string, string>();
  const initializedEventOwners = new Map<string, string>();

  for (const module of modules) {
    const injection = module.injection;
    if (!injection) continue;

    const windowKey = injection.windowKey.trim();
    if (windowKey.length > 0) {
      const existingNamespace = windowKeyOwners.get(windowKey);
      if (existingNamespace) {
        throw new Error(
          `Provider modules expose duplicate injection windowKey "${windowKey}" for namespaces "${existingNamespace}" and "${module.namespace}"`,
        );
      }

      windowKeyOwners.set(windowKey, module.namespace);
    }

    const initializedEvent = injection.initializedEvent?.trim();
    if (!initializedEvent) continue;

    const existingNamespace = initializedEventOwners.get(initializedEvent);
    if (existingNamespace) {
      throw new Error(
        `Provider modules expose duplicate injection initializedEvent "${initializedEvent}" for namespaces "${existingNamespace}" and "${module.namespace}"`,
      );
    }

    initializedEventOwners.set(initializedEvent, module.namespace);
  }
};

const shouldCreateProviderOnInitialize = (module: ProviderModule) => {
  return !!module.injection || !!module.discovery?.eip6963;
};

const hasEip6963Discovery = (module: ProviderModule) => {
  return !!module.discovery?.eip6963;
};

/**
 * Composes page-side providers from installed modules and exposes them to the page.
 */
export class ProviderHost {
  #targetWindow: ProviderHostWindow;
  #modules: readonly ProviderModule[];
  #modulesByNamespace: ReadonlyMap<string, ProviderModule>;
  #modulesToInitialize: readonly ProviderModule[];
  #eip6963Modules: readonly ProviderModule[];
  #eip6963Bridge: Eip6963Bridge | null;
  #logger: ProviderHostLogger;
  #createTransportForNamespace: (namespace: string) => Transport;

  // namespace -> provider instance
  #providers = new Map<string, ProviderCacheEntry>();
  #transports = new Map<string, Transport>();

  // windowKey -> injected provider
  #injectedByWindowKey = new Map<string, object>();
  #initializedEventsDispatched = new Set<string>();
  #initialized = false;
  #destroyed = false;

  constructor({ targetWindow, createTransportForNamespace, modules, logger }: ProviderHostOptions) {
    this.#targetWindow = targetWindow;
    this.#modules = modules;
    this.#modulesByNamespace = indexProviderModules(modules);
    assertUniqueModuleInjectionBindings(modules);
    this.#modulesToInitialize = modules.filter(shouldCreateProviderOnInitialize);
    this.#eip6963Modules = modules.filter(hasEip6963Discovery);
    this.#eip6963Bridge =
      this.#eip6963Modules.length > 0
        ? createEip6963Bridge({
            targetWindow,
            getProviders: () => this.#getEip6963Providers(),
          })
        : null;
    this.#logger = logger ?? {};
    this.#createTransportForNamespace = createTransportForNamespace;
  }

  /**
   * Creates the configured page-side providers and exposes their page bindings once.
   */
  initialize() {
    this.#assertUsable("initialize");
    if (this.#initialized) return;
    this.#initialized = true;

    this.#eip6963Bridge?.initialize();

    for (const module of this.#modulesToInitialize) {
      this.#getOrCreateProvider(module.namespace);
    }

    this.#dispatchInitializedEvents();
  }

  /**
   * Starts bootstrap for one namespace without waiting for a dapp request.
   */
  async prewarm(namespace: string) {
    this.#assertUsable("prewarm");
    const provider = this.#getOrCreateProvider(namespace);
    if (!provider) {
      return;
    }

    try {
      await this.#getOrCreateTransport(namespace).bootstrap();
    } catch (error) {
      this.#logger.debug?.(`[provider-host] transport bootstrap failed for namespace "${namespace}"`, error);
    }
  }

  /**
   * Starts bootstrap for each namespace in parallel.
   */
  async prewarmNamespaces(namespaces: readonly string[]) {
    this.#assertUsable("prewarmNamespaces");
    await Promise.all(namespaces.map((namespace) => this.prewarm(namespace)));
  }

  /**
   * Releases listeners and transports owned by this host.
   *
   * This does not remove providers that were already injected onto `window`.
   */
  destroy() {
    if (this.#destroyed) return;

    this.#destroyed = true;
    this.#initialized = false;
    this.#eip6963Bridge?.destroy();

    for (const [namespace, transport] of this.#transports) {
      try {
        if (transport.destroy) {
          transport.destroy();
          continue;
        }

        void transport.disconnect().catch((error) => {
          this.#logger.debug?.(
            `[provider-host] transport disconnect failed during destroy for namespace "${namespace}"`,
            error,
          );
        });
      } catch (error) {
        this.#logger.debug?.(`[provider-host] transport cleanup failed for namespace "${namespace}"`, error);
      }
    }

    this.#providers.clear();
    this.#transports.clear();
    this.#injectedByWindowKey.clear();
    this.#initializedEventsDispatched.clear();
  }

  #dispatchInitializedEvents() {
    for (const module of this.#modules) {
      const injection = module.injection;
      if (!injection?.initializedEvent) continue;

      const injected = this.#injectedByWindowKey.get(injection.windowKey);
      if (!injected) continue;

      const eventName = injection.initializedEvent;
      if (this.#initializedEventsDispatched.has(eventName)) continue;
      this.#initializedEventsDispatched.add(eventName);

      this.#targetWindow.dispatchEvent(new this.#targetWindow.Event(eventName));
    }
  }

  #getOrCreateProvider(namespace: string): object | null {
    const cached = this.#providers.get(namespace);
    if (cached) return cached.entry.injected;

    const module = this.#modulesByNamespace.get(namespace);
    if (!module) return null;

    const entry = module.create({ transport: this.#getOrCreateTransport(namespace) });
    this.#providers.set(namespace, { module, entry });

    if (module.injection) {
      this.#maybeInjectProvider(module.injection.windowKey, entry.injected, module.injection.mode);
    }

    return entry.injected;
  }

  #getOrCreateTransport(namespace: string): Transport {
    const cached = this.#transports.get(namespace);
    if (cached) {
      return cached;
    }

    const transport = this.#createTransportForNamespace(namespace);
    for (const [existingNamespace, existingTransport] of this.#transports) {
      if (existingTransport !== transport) {
        continue;
      }
      throw new Error(
        `createTransportForNamespace must return a distinct transport per namespace; received the same transport for "${existingNamespace}" and "${namespace}"`,
      );
    }
    this.#transports.set(namespace, transport);
    return transport;
  }

  #maybeInjectProvider(windowKey: string, provider: object, mode: "if_absent" | "never" | undefined) {
    if (mode === "never") return;

    const hostWindow = this.#targetWindow as unknown as Window;

    // Use `in` to avoid overwriting providers exposed via prototype chain / accessors.
    const hasProvider = windowKey in (hostWindow as unknown as Record<string, unknown>);
    if (hasProvider) return;

    try {
      Object.defineProperty(hostWindow, windowKey, {
        configurable: true,
        enumerable: false,
        value: provider,
        writable: false,
      });
    } catch {
      try {
        (hostWindow as unknown as Record<string, unknown>)[windowKey] = provider;
      } catch {
        // Best-effort: do not throw if the window is locked down by another wallet / environment.
      }
    }

    if ((hostWindow as unknown as Record<string, unknown>)[windowKey] === provider) {
      this.#injectedByWindowKey.set(windowKey, provider);
    }
  }

  #getEip6963Providers() {
    const providers: Array<{
      info: NonNullable<NonNullable<ProviderModule["discovery"]>["eip6963"]>["info"];
      provider: object;
    }> = [];

    for (const module of this.#eip6963Modules) {
      const info = module.discovery?.eip6963?.info;
      if (!info) continue;

      const provider = this.#getOrCreateProvider(module.namespace);
      if (!provider) continue;

      providers.push({ info, provider });
    }

    return providers;
  }

  #assertUsable(action: "initialize" | "prewarm" | "prewarmNamespaces") {
    if (!this.#destroyed) {
      return;
    }

    throw new Error(`ProviderHost cannot ${action} after destroy()`);
  }
}

/**
 * Creates a host for page-side provider injection and discovery.
 */
export const createProviderHost = (options: ProviderHostOptions) => new ProviderHost(options);
