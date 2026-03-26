import type { ProviderEntry, ProviderModule, ProviderRegistry } from "../registry/index.js";
import type { EIP1193Provider, Transport } from "../types/index.js";

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
  registry: ProviderRegistry;
  logger?: ProviderHostLogger;
};

type ProviderCacheEntry = Readonly<{
  module: ProviderModule;
  entry: ProviderEntry;
}>;

export class ProviderHost {
  #targetWindow: ProviderHostWindow;
  #registry: ProviderRegistry;
  #logger: ProviderHostLogger;
  #createTransportForNamespace: (namespace: string) => Transport;

  // namespace -> provider instance
  #providers = new Map<string, ProviderCacheEntry>();
  #transports = new Map<string, Transport>();

  // windowKey -> injected provider
  #injectedByWindowKey = new Map<string, EIP1193Provider>();
  #initializedEventsDispatched = new Set<string>();

  #eip6963Registered = false;

  #initialized = false;
  #destroyed = false;

  constructor({ targetWindow, createTransportForNamespace, registry, logger }: ProviderHostOptions) {
    this.#targetWindow = targetWindow;
    this.#registry = registry;
    this.#logger = logger ?? {};
    this.#createTransportForNamespace = createTransportForNamespace;
  }

  initialize() {
    if (this.#initialized || this.#destroyed) return;
    this.#initialized = true;

    // Eagerly create providers that are meant to be injected and/or discovered.
    for (const module of this.#registry.modules) {
      if (module.injection || module.discovery?.eip6963) {
        this.#getOrCreateProvider(module.namespace);
      }
    }

    if (this.#hasAnyEip6963Provider()) {
      this.#registerEip6963Listener();
    }

    // Dispatch initialized events only when injection succeeds.
    this.#dispatchInitializedEvents();

    if (this.#hasAnyEip6963Provider()) {
      this.#announceProviders();
    }

    for (const namespace of this.#transports.keys()) {
      void this.#connectTransport(namespace);
    }
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;

    if (this.#eip6963Registered) {
      this.#targetWindow.removeEventListener("eip6963:requestProvider", this.#handleProviderRequest);
      this.#eip6963Registered = false;
    }

    for (const { entry } of this.#providers.values()) {
      try {
        entry.destroy?.();
      } catch {
        // ignore teardown errors
      }
    }

    this.#providers.clear();

    for (const transport of this.#transports.values()) {
      void transport.disconnect().catch(() => {
        // ignore disconnect failures during teardown
      });
      this.#destroyTransport(transport);
    }

    this.#transports.clear();
    this.#injectedByWindowKey.clear();
    this.#initializedEventsDispatched.clear();
  }

  async #connectTransport(namespace: string) {
    if (this.#destroyed) return;
    const transport = this.#transports.get(namespace);
    if (!transport) return;

    try {
      await transport.connect();
    } catch (error) {
      // Best-effort: never block injection flow.
      this.#logger.debug?.(`[provider-host] transport connect failed for namespace "${namespace}"`, error);
    }
  }

  #hasAnyEip6963Provider() {
    return this.#registry.modules.some((module) => !!module.discovery?.eip6963);
  }

  #dispatchInitializedEvents() {
    for (const module of this.#registry.modules) {
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

  #getOrCreateProvider(namespace: string): EIP1193Provider | null {
    const cached = this.#providers.get(namespace);
    if (cached) return cached.entry.injected;

    const module = this.#registry.byNamespace.get(namespace);
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

  #maybeInjectProvider(windowKey: string, provider: EIP1193Provider, mode: "if_absent" | "never" | undefined) {
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

  #destroyTransport(transport: Transport) {
    const candidate = transport as Transport & { destroy?: () => void };
    try {
      candidate.destroy?.();
    } catch {
      // ignore teardown errors
    }
  }

  #registerEip6963Listener() {
    if (this.#eip6963Registered) return;
    this.#targetWindow.addEventListener("eip6963:requestProvider", this.#handleProviderRequest);
    this.#eip6963Registered = true;
  }

  #handleProviderRequest = () => {
    if (this.#destroyed) return;
    this.#announceProviders();
  };

  #announceProviders() {
    for (const { module, entry } of this.#providers.values()) {
      const info = module.discovery?.eip6963?.info;
      if (!info) continue;

      const detail = Object.freeze({
        info: Object.freeze({ ...info }),
        provider: entry.injected,
      });

      this.#targetWindow.dispatchEvent(
        new this.#targetWindow.CustomEvent("eip6963:announceProvider", {
          detail,
        }),
      );
    }
  }
}

export const createProviderHost = (options: ProviderHostOptions) => new ProviderHost(options);
