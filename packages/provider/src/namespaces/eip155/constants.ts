import { EIP155_NAMESPACE, EIP155_PASSTHROUGH_READONLY_METHODS } from "@arx/core";

export { EIP155_NAMESPACE };

export const REQUEST_VALIDATION_MESSAGES = {
  invalidArgs: "Expected a single, non-array, object argument.",
  invalidMethod: "'args.method' must be a non-empty string.",
  invalidParams: "'args.params' must be an object or array if provided.",
} as const;

export const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_NORMAL_TIMEOUT_MS = 120_000;
export const DEFAULT_READONLY_TIMEOUT_MS = 60_000;

export const DEFAULT_READY_TIMEOUT_MS = 10_000;
export const DEFAULT_ETH_ACCOUNTS_WAIT_MS = 200;

// Keep this list aligned with methods that may block on user approval.
export const DEFAULT_APPROVAL_METHOD_NAMES = [
  "eth_requestAccounts",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
  "wallet_requestPermissions",
] as const;

export const DEFAULT_READONLY_METHOD_NAMES = [
  "eth_chainId",
  "eth_accounts",
  ...EIP155_PASSTHROUGH_READONLY_METHODS,
] as const;
