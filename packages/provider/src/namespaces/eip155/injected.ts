import type { RequestArguments } from "../../types/eip1193.js";
import type { Eip155Provider } from "./provider.js";

const PROTECTED_KEYS = new Set<PropertyKey>([
  "request",
  "send",
  "sendAsync",
  "on",
  "removeListener",
  "removeAllListeners",
  "enable",
  "wallet_getPermissions",
  "wallet_requestPermissions",
  "chainId",
  "networkVersion",
  "selectedAddress",
  "isMetaMask",
  "_metamask",
]);

// Injected provider surface for `window.ethereum`.
// Keeps MetaMask-compatible shims and hardens against dapp-side mutation.
export const createEip155InjectedProvider = (target: Eip155Provider): Eip155Provider => {
  const getNetworkVersion = () => target.getProviderState().networkVersion;
  const getInjectedProperty = (instance: Eip155Provider, property: PropertyKey) =>
    Reflect.get(instance, property, instance);

  const metamaskShim = Object.freeze({
    isUnlocked: () => Promise.resolve(target.getProviderState().isUnlocked),
  });

  const handler: ProxyHandler<Eip155Provider> = {
    // NOTE: Use `instance` as receiver to avoid Proxy/private-field getter issues.
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
      if (PROTECTED_KEYS.has(property)) return true;
      return Reflect.set(instance, property, value, instance);
    },
    defineProperty: (instance, property, descriptor) => {
      if (PROTECTED_KEYS.has(property)) return true;
      return Reflect.defineProperty(instance, property, descriptor);
    },
    deleteProperty: (instance, property) => {
      if (PROTECTED_KEYS.has(property)) return true;
      return Reflect.deleteProperty(instance, property);
    },
    getOwnPropertyDescriptor: (instance, property) => {
      if (property === "selectedAddress" || property === "chainId") {
        return {
          configurable: true,
          enumerable: true,
          get: () => getInjectedProperty(instance, property),
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
