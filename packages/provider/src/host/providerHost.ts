import type { EIP1193Provider, Transport, TransportMeta, TransportState } from "../types/index.js";
import {
  createProviderRegistry,
  EIP155_NAMESPACE,
  type ProviderEntry,
  type ProviderRegistry,
} from "../registry/index.js";

const WINDOW_ETH_PROP = "ethereum";

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
};

export class ProviderHost {
  #targetWindow: ProviderHostWindow;
  #transport: Transport;
  #providers = new Map<string, ProviderEntry>();
  #registry: ProviderRegistry;

  #features: Required<ProviderHostFeatures>;

  #eip6963Registered = false;
  #injectedEthereum: EIP1193Provider | null = null;

  #initialized = false;
  #initializedEventDispatched = false;

  constructor(options: ProviderHostOptions) {
    this.#targetWindow = options.targetWindow;
    this.#transport = options.transport;
    this.#registry = options.registry ?? createProviderRegistry();
    this.#features = { eip6963: options.features?.eip6963 ?? true };
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#registerTransportListeners();

    this.#getOrCreateProvider(EIP155_NAMESPACE);

    if (this.#features.eip6963) {
      this.#registerEip6963Listener();
      this.#announceProviders();
    }

    this.#dispatchEthereumInitialized();
    void this.#connectToTransport();
  }

  async #connectToTransport() {
    try {
      await this.#transport.connect();
    } catch (error) {
      // Best-effort: never block injection flow.
      console.debug("[provider-host] transport connect failed", error);
      return;
    }

    this.#syncProvidersFromState(this.#transport.getConnectionState());
  }

  #dispatchEthereumInitialized() {
    if (this.#initializedEventDispatched) return;
    if (!this.#injectedEthereum) return;

    this.#initializedEventDispatched = true;
    this.#targetWindow.dispatchEvent(new this.#targetWindow.Event("ethereum#initialized"));
  }

  #registerTransportListeners() {
    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
  }

  #getOrCreateProvider(namespace: string): EIP1193Provider | null {
    if (this.#providers.has(namespace)) return this.#providers.get(namespace)!.proxy;

    const factory = this.#registry.factories[namespace];
    if (!factory) return null;

    const entry = factory({ transport: this.#transport });
    this.#providers.set(namespace, entry);

    const injection = this.#registry.injectionByNamespace[namespace];
    if (injection?.windowKey) {
      this.#injectWindowProvider(injection.windowKey, entry.proxy);
    }

    return entry.proxy;
  }

  #injectWindowProvider(windowKey: string, provider: EIP1193Provider) {
    if (windowKey === WINDOW_ETH_PROP) {
      this.#injectWindowEthereum(provider);
      return;
    }
  }

  #syncProvidersFromState(state: TransportState) {
    const namespaces = this.#extractNamespaces(state.meta, state.caip2);
    for (const namespace of namespaces) {
      this.#getOrCreateProvider(namespace);
    }
  }

  #extractNamespaces(meta: TransportMeta | null | undefined, fallback: string | null) {
    const namespaces = new Set<string>();

    if (meta?.activeNamespace) namespaces.add(meta.activeNamespace);

    if (meta?.supportedChains?.length) {
      for (const chainRef of meta.supportedChains) {
        const [namespace] = chainRef.split(":");
        if (namespace) namespaces.add(namespace);
      }
    }

    if (fallback) {
      const [namespace] = fallback.split(":");
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
    this.#syncProvidersFromState(this.#transport.getConnectionState());
    this.#announceProviders();
  };

  #announceProviders() {
    const evmEntry = this.#providers.get(EIP155_NAMESPACE);
    if (!evmEntry) return;

    this.#targetWindow.dispatchEvent(
      new this.#targetWindow.CustomEvent("eip6963:announceProvider", {
        detail: { info: evmEntry.info, provider: evmEntry.proxy },
      }),
    );
  }

  #injectWindowEthereum(proxy: EIP1193Provider) {
    if (this.#injectedEthereum === proxy) return;

    const hostWindow = this.#targetWindow as unknown as Window;
    const hasProvider = Object.hasOwn(hostWindow, WINDOW_ETH_PROP);
    if (hasProvider) return;

    Object.defineProperty(hostWindow, WINDOW_ETH_PROP, {
      configurable: true,
      enumerable: false,
      value: proxy,
      writable: false,
    });

    this.#injectedEthereum = proxy;
  }

  #handleTransportConnect = () => {
    const state = this.#transport.getConnectionState();
    this.#syncProvidersFromState(state);
  };

  #handleTransportDisconnect = () => {
    // no-op
  };
}

export const createProviderHost = (options: ProviderHostOptions) => new ProviderHost(options);
