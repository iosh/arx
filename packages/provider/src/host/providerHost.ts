import {
  createProviderRegistry,
  type ProviderEntry,
  type ProviderModule,
  type ProviderRegistry,
} from "../registry/index.js";
import type { EIP1193Provider, Transport, TransportMeta, TransportState } from "../types/index.js";

type ProviderHostLogger = Readonly<{
  debug?: (message: string, meta?: unknown) => void;
}>;

export type ProviderHostFeatures = {
  eip6963?: boolean;
};

// NOTE: TypeScript's lib.dom does not model Event/CustomEvent as properties on Window, but they exist at runtime per-realm.
// We use constructors from the provided targetWindow to ensure events are created in the correct realm (e.g. JSDOM/iframes).
export type ProviderHostWindow = Window & {
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
};

export type ProviderHostOptions = {
  targetWindow: ProviderHostWindow;
  transport: Transport;
  registry?: ProviderRegistry;
  features?: ProviderHostFeatures;
  logger?: ProviderHostLogger;
};

type ProviderCacheEntry = Readonly<{
  module: ProviderModule;
  entry: ProviderEntry;
}>;

export class ProviderHost {
  #targetWindow: ProviderHostWindow;
  #transport: Transport;
  #registry: ProviderRegistry;
  #logger: ProviderHostLogger;

  #features: Required<ProviderHostFeatures>;

  // namespace -> provider instance
  #providers = new Map<string, ProviderCacheEntry>();

  // windowKey -> injected provider
  #injectedByWindowKey = new Map<string, EIP1193Provider>();
  #initializedEventsDispatched = new Set<string>();

  #eip6963Registered = false;

  #initialized = false;
  #destroyed = false;
  #connectAttempt = 0;
  #lastConnectEventAttempt = 0;

  constructor(options: ProviderHostOptions) {
    this.#targetWindow = options.targetWindow;
    this.#transport = options.transport;
    this.#registry = options.registry ?? createProviderRegistry();
    this.#features = { eip6963: options.features?.eip6963 ?? true };
    this.#logger = options.logger ?? {};
  }

  initialize() {
    if (this.#initialized || this.#destroyed) return;
    this.#initialized = true;

    this.#registerTransportListeners();

    // Eagerly create providers that are meant to be injected and/or discovered.
    for (const m of this.#registry.modules) {
      if (m.injection || m.discovery?.eip6963) {
        this.#getOrCreateProvider(m.namespace);
      }
    }

    if (this.#features.eip6963 && this.#hasAnyEip6963Provider()) {
      this.#registerEip6963Listener();
    }

    // Dispatch initialized events only when injection succeeds.
    this.#dispatchInitializedEvents();

    void this.#connectToTransport();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;

    this.#transport.removeListener("connect", this.#handleTransportConnect);
    this.#transport.removeListener("disconnect", this.#handleTransportDisconnect);

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
    this.#injectedByWindowKey.clear();
    this.#initializedEventsDispatched.clear();
  }

  async #connectToTransport() {
    if (this.#destroyed) return;
    const attempt = ++this.#connectAttempt;
    try {
      await this.#transport.connect();
    } catch (error) {
      // Best-effort: never block injection flow.
      this.#logger.debug?.("[provider-host] transport connect failed", error);
      return;
    }

    // Most transports will emit "connect" during connect() which also triggers a sync.
    // As a backstop, sync once here only if no connect event was observed for this attempt.
    if (this.#lastConnectEventAttempt !== attempt) {
      this.#syncProvidersFromState(this.#transport.getConnectionState());
    }
  }

  #registerTransportListeners() {
    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
  }

  #hasAnyEip6963Provider() {
    return this.#registry.modules.some((m) => !!m.discovery?.eip6963);
  }

  #dispatchInitializedEvents() {
    for (const m of this.#registry.modules) {
      const injection = m.injection;
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

    const entry = module.create({ transport: this.#transport });
    this.#providers.set(namespace, { module, entry });

    if (module.injection) {
      this.#maybeInjectProvider(module.injection.windowKey, entry.injected, module.injection.mode);
    }

    return entry.injected;
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

  #syncProvidersFromState(state: TransportState) {
    const namespaces = this.#extractNamespaces(state.meta, state.chainRef);
    for (const ns of namespaces) {
      this.#getOrCreateProvider(ns);
    }
    this.#dispatchInitializedEvents();
  }

  #extractNamespaces(meta: TransportMeta | null | undefined, fallbackChainRef: string | null) {
    const namespaces = new Set<string>();

    if (meta?.activeNamespace) namespaces.add(meta.activeNamespace);

    if (meta?.supportedChains?.length) {
      for (const chainRef of meta.supportedChains) {
        const [namespace] = chainRef.split(":");
        if (namespace) namespaces.add(namespace);
      }
    }

    if (fallbackChainRef) {
      const [namespace] = fallbackChainRef.split(":");
      if (namespace) namespaces.add(namespace);
    }

    return namespaces;
  }

  #registerEip6963Listener() {
    if (this.#eip6963Registered) return;
    this.#targetWindow.addEventListener("eip6963:requestProvider", this.#handleProviderRequest);
    this.#eip6963Registered = true;
  }

  #handleProviderRequest = () => {
    if (this.#destroyed) return;
    this.#syncProvidersFromState(this.#transport.getConnectionState());
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

  #handleTransportConnect = () => {
    if (this.#destroyed) return;
    this.#lastConnectEventAttempt = this.#connectAttempt;
    const state = this.#transport.getConnectionState();
    this.#syncProvidersFromState(state);
  };

  #handleTransportDisconnect = () => {
    // no-op: the injected provider surfaces manage their own disconnect semantics.
  };
}

export const createProviderHost = (options: ProviderHostOptions) => new ProviderHost(options);
