import type { RequestArguments } from "../../types/eip1193.js";
import { EIP155_INJECTED_PROTECTED_KEYS } from "./injectedConstants.js";
import type { Eip155Provider } from "./provider.js";

const PROTECTED_KEYS = new Set<PropertyKey>(EIP155_INJECTED_PROTECTED_KEYS);

// Injected provider surface for `window.ethereum`.
// Keeps compatibility shims and hardens against dapp-side mutation.
export const createEip155InjectedProvider = (target: Eip155Provider): Eip155Provider => {
  const getNetworkVersion = () => target.getProviderState().networkVersion;
  // Always read values with `instance` as receiver so getters can access private fields safely.
  // (If a getter uses `#private`, using the Proxy as receiver would throw.)
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
      // Enforce a read-only injected surface by reporting a failed assignment.
      // In strict mode, this becomes a TypeError (matching common ecosystem expectations).
      if (PROTECTED_KEYS.has(property)) return false;
      return Reflect.set(instance, property, value, instance);
    },
    defineProperty: (instance, property, descriptor) => {
      // Enforce read-only semantics for protected keys.
      if (PROTECTED_KEYS.has(property)) return false;
      return Reflect.defineProperty(instance, property, descriptor);
    },
    deleteProperty: (instance, property) => {
      // Enforce read-only semantics for protected keys.
      if (PROTECTED_KEYS.has(property)) return false;
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
