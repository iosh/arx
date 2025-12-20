import type { EthereumProvider } from "../provider.js";
import type { RequestArguments } from "../types/eip1193.js";

const PROTECTED_METHODS = new Set<PropertyKey>([
  "request",
  "send",
  "sendAsync",
  "on",
  "removeListener",
  "removeAllListeners",
  "enable",
  "chainId",
  "networkVersion",
  "selectedAddress",
  "isMetaMask",
  "_metamask",
]);

export const createEvmProxy = (target: EthereumProvider): EthereumProvider => {
  const getNetworkVersion = () => target.getProviderState().networkVersion;

  const metamaskShim = Object.freeze({
    isUnlocked: () => Promise.resolve(target.getProviderState().isUnlocked),
  });

  const handler: ProxyHandler<EthereumProvider> = {
    get: (instance, property) => {
      switch (property) {
        case "selectedAddress":
          return instance.selectedAddress;
        case "chainId":
          return instance.chainId;
        case "networkVersion":
          return getNetworkVersion();
        case "isMetaMask":
          return true;
        case "wallet_getPermissions":
          return () => instance.request({ method: "wallet_getPermissions" });
        case "wallet_requestPermissions":
          return (params?: RequestArguments["params"]) =>
            params === undefined
              ? instance.request({ method: "wallet_requestPermissions" })
              : instance.request({ method: "wallet_requestPermissions", params });
        case "_metamask":
          return metamaskShim;
        default:
          return Reflect.get(instance, property, instance);
      }
    },
    has: (instance, property) => {
      if (
        property === "selectedAddress" ||
        property === "chainId" ||
        property === "networkVersion" ||
        property === "isMetaMask" ||
        property === "_metamask" ||
        property === "wallet_getPermissions" ||
        property === "wallet_requestPermissions"
      ) {
        return true;
      }
      return property in instance;
    },
    set: (instance, property, value) => {
      if (PROTECTED_METHODS.has(property)) return true;
      return Reflect.set(instance, property, value, instance);
    },
    defineProperty: (instance, property, descriptor) => {
      if (PROTECTED_METHODS.has(property)) return true;
      return Reflect.defineProperty(instance, property, descriptor);
    },
    deleteProperty: (instance, property) => {
      if (PROTECTED_METHODS.has(property)) return true;
      return Reflect.deleteProperty(instance, property);
    },
    getOwnPropertyDescriptor: (instance, property) => {
      if (property === "selectedAddress" || property === "chainId") {
        return {
          configurable: true,
          enumerable: true,
          get: () => (property === "selectedAddress" ? instance.selectedAddress : instance.chainId),
        };
      }
      if (property === "networkVersion") {
        return { configurable: true, enumerable: true, get: () => getNetworkVersion() };
      }
      if (property === "isMetaMask") {
        return { configurable: true, enumerable: true, value: true, writable: false };
      }
      if (property === "_metamask") {
        return { configurable: true, enumerable: false, value: metamaskShim, writable: false };
      }
      return Reflect.getOwnPropertyDescriptor(instance, property);
    },
  };

  return new Proxy(target, handler);
};
