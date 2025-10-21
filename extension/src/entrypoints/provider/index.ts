import { EthereumProvider } from "@arx/provider-core/provider";
import type { RequestArguments, TransportMeta, TransportState } from "@arx/provider-core/types";
import { InpageTransport } from "@arx/provider-extension/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

const EIP155_NAMESPACE = "eip155" as const;
const PROTECTED_METHODS = new Set<PropertyKey>([
  "request",
  "send",
  "sendAsync",
  "on",
  "removeListener",
  "removeAllListeners",
  "enable",
]);
const WINDOW_ETH_PROP = "ethereum";

type WindowWithArxHost = Window & {
  __ARX_PROVIDER_HOST__?: ProviderHost;
};

type ProviderEntry = {
  raw: EthereumProvider;
  proxy: EthereumProvider;
  info: typeof EthereumProvider.providerInfo;
};

const asWindowWithHost = (target: Window): WindowWithArxHost => target as WindowWithArxHost;

const createEvmProxy = (target: EthereumProvider): EthereumProvider => {
  const metamaskShim = Object.freeze({
    isUnlocked: () => Promise.resolve(target.isUnlocked === true),
    requestBatch: (requests: RequestArguments[]) => {
      return Promise.all(requests.map((req) => target.request(req)));
    },
  });

  const handler: ProxyHandler<EthereumProvider> = {
    get: (instance, property, receiver) => {
      switch (property) {
        case "selectedAddress":
          return instance.selectedAddress;
        case "chainId":
          return instance.chainId;
        case "isMetaMask":
          return false;
        case "_metamask":
          return metamaskShim;
        default:
          return Reflect.get(instance, property, receiver);
      }
    },
    has: (instance, property) => {
      if (
        property === "selectedAddress" ||
        property === "chainId" ||
        property === "isMetaMask" ||
        property === "_metamask"
      ) {
        return true;
      }
      return property in instance;
    },
    set: (instance, property, value, receiver) => {
      if (PROTECTED_METHODS.has(property)) {
        return false;
      }
      return Reflect.set(instance, property, value, receiver);
    },
    defineProperty: (instance, property, descriptor) => {
      if (PROTECTED_METHODS.has(property)) {
        return false;
      }
      return Reflect.defineProperty(instance, property, descriptor);
    },
    getOwnPropertyDescriptor: (instance, property) => {
      if (property === "selectedAddress" || property === "chainId") {
        return {
          configurable: true,
          enumerable: true,
          get: () => (property === "selectedAddress" ? instance.selectedAddress : instance.chainId),
        };
      }
      if (property === "isMetaMask") {
        return {
          configurable: true,
          enumerable: true,
          value: false,
          writable: false,
        };
      }
      if (property === "_metamask") {
        return {
          configurable: true,
          enumerable: false,
          value: metamaskShim,
          writable: false,
        };
      }
      return Reflect.getOwnPropertyDescriptor(instance, property);
    },
  };

  return new Proxy(target, handler);
};

class ProviderHost {
  #transport: InpageTransport;
  #providers = new Map<string, ProviderEntry>();
  #startPromise: Promise<void> | null = null;
  #eip6963Registered = false;
  #injectedEthereum: EthereumProvider | null = null;

  constructor(transport: InpageTransport) {
    this.#transport = transport;
  }

  start() {
    if (this.#startPromise) return this.#startPromise;

    this.#startPromise = (async () => {
      this.#registerTransportListeners();
      try {
        await this.#transport.connect();
      } catch (error) {
        console.error("[provider-host] failed to connect transport", error);
        this.#startPromise = null;
        throw error;
      }
      this.#syncProvidersFromState(this.#transport.getConnectionState());
      this.#registerEip6963Listener();
      this.#announceProviders();
    })();

    return this.#startPromise;
  }

  #registerTransportListeners() {
    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
  }

  #syncProvidersFromState(state: TransportState) {
    const namespaces = this.#extractNamespaces(state.meta, state.caip2);
    for (const namespace of namespaces) {
      switch (namespace) {
        case EIP155_NAMESPACE:
          this.#ensureEvmProvider();
          break;
        default:
          break;
      }
    }
  }

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

  #ensureEvmProvider() {
    if (this.#providers.has(EIP155_NAMESPACE)) {
      return this.#providers.get(EIP155_NAMESPACE)!.proxy;
    }

    const raw = new EthereumProvider({ transport: this.#transport });
    const proxy = createEvmProxy(raw);
    const entry: ProviderEntry = {
      raw,
      proxy,
      info: EthereumProvider.providerInfo,
    };
    this.#providers.set(EIP155_NAMESPACE, entry);
    this.#injectWindowEthereum(proxy);
    return proxy;
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
    if (!evmEntry) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: evmEntry.info,
          provider: evmEntry.proxy,
        },
      }),
    );
  }

  #injectWindowEthereum(proxy: EthereumProvider) {
    if (this.#injectedEthereum === proxy) {
      return;
    }

    const hostWindow = window as Window;
    const hasProvider = Object.hasOwn(hostWindow, WINDOW_ETH_PROP);
    if (!hasProvider) {
      Object.defineProperty(hostWindow, WINDOW_ETH_PROP, {
        configurable: true,
        enumerable: false,
        value: proxy,
        writable: false,
      });
      this.#injectedEthereum = proxy;
      return;
    }
  }

  #handleTransportConnect = () => {
    const state = this.#transport.getConnectionState();
    this.#syncProvidersFromState(state);
  };

  #handleTransportDisconnect = () => {
    // no-op: provider 生命周期保持，等待下次连接
  };
}

const ensureProviderHost = () => {
  const globalWindow = asWindowWithHost(window);
  if (globalWindow.__ARX_PROVIDER_HOST__) {
    return globalWindow.__ARX_PROVIDER_HOST__;
  }
  const transport = new InpageTransport();
  const host = new ProviderHost(transport);
  globalWindow.__ARX_PROVIDER_HOST__ = host;
  return host;
};

export default defineUnlistedScript(async () => {
  const host = ensureProviderHost();
  await host.start();
});
