import type { InpageTransport } from "@arx/extension-provider/inpage";
import type { EIP1193Provider, TransportMeta, TransportState } from "@arx/provider/types";
import { createProviderRegistry, EIP155_NAMESPACE, type ProviderEntry } from "./providerRegistry";

const WINDOW_ETH_PROP = "ethereum";

type WindowWithArxHost = Window & {
  __ARX_PROVIDER_HOST__?: ProviderHost;
};

export const asWindowWithHost = (target: Window): WindowWithArxHost => target as WindowWithArxHost;

export class ProviderHost {
  #transport: InpageTransport;
  #providers = new Map<string, ProviderEntry>();
  #registry = createProviderRegistry();

  #eip6963Registered = false;
  #injectedEthereum: EIP1193Provider | null = null;

  #initialized = false;
  #initializedEventDispatched = false;

  constructor(transport: InpageTransport) {
    this.#transport = transport;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#registerTransportListeners();

    this.#getOrCreateProvider(EIP155_NAMESPACE);

    this.#registerEip6963Listener();
    this.#announceProviders();
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
    window.dispatchEvent(new window.Event("ethereum#initialized"));
  }

  #registerTransportListeners() {
    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
  }

  // Lazy-create provider on demand to minimize startup cost
  #getOrCreateProvider(namespace: string): EIP1193Provider | null {
    if (this.#providers.has(namespace)) return this.#providers.get(namespace)!.proxy;

    const factory = this.#registry.factories[namespace];
    if (!factory) return null; // Unknown namespace, silently ignored

    const entry = factory({ transport: this.#transport });
    this.#providers.set(namespace, entry);

    // Auto-inject to window if configured
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
    // Unknown window keys are intentionally ignored for now.
  }

  #syncProvidersFromState(state: TransportState) {
    const namespaces = this.#extractNamespaces(state.meta, state.caip2);
    for (const namespace of namespaces) {
      this.#getOrCreateProvider(namespace);
    }
  }

  // Extract unique namespaces from transport state to determine which providers to create
  #extractNamespaces(meta: TransportMeta | null | undefined, fallback: string | null) {
    const namespaces = new Set<string>();

    if (meta?.activeNamespace) {
      namespaces.add(meta.activeNamespace);
    }

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
    window.addEventListener("eip6963:requestProvider", this.#handleProviderRequest);
    this.#eip6963Registered = true;
  }

  #handleProviderRequest = () => {
    this.#syncProvidersFromState(this.#transport.getConnectionState());
    this.#announceProviders();
  };

  #announceProviders() {
    const evmEntry = this.#providers.get(EIP155_NAMESPACE);
    if (!evmEntry) return;

    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: evmEntry.info,
          provider: evmEntry.proxy,
        },
      }),
    );
  }

  #injectWindowEthereum(proxy: EIP1193Provider) {
    if (this.#injectedEthereum === proxy) return;

    const hostWindow = window as Window;
    const hasProvider = Object.hasOwn(hostWindow, WINDOW_ETH_PROP);
    // EIP-6963 multi-wallet coexistence: don't overwrite existing ethereum provider
    if (hasProvider) return;

    Object.defineProperty(hostWindow, WINDOW_ETH_PROP, {
      configurable: true,
      enumerable: false, // Non-enumerable to prevent dApp detection via Object.keys
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
    // no-op: provider lifecycle is maintained, waiting for next connection.
  };
}
