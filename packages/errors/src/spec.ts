import type { JsonRpcErrorObject } from "./jsonRpc.js";

export type ErrorExposure = "ui_only" | "ui_and_dapp";

export type ArxReasonSpec = {
  exposure: ErrorExposure;
  dapp: Pick<JsonRpcErrorObject, "code" | "message">;
  ui: { message: string };
};

// Single source of truth:
// - adding a new reason requires adding its public surface semantics here.
export const ArxErrorSpec = {
  VaultNotInitialized: {
    exposure: "ui_only",
    dapp: { code: 4100, message: "Unauthorized" },
    ui: { message: "Vault is not initialized" },
  },
  VaultLocked: {
    exposure: "ui_and_dapp",
    dapp: { code: 4100, message: "Unauthorized" },
    ui: { message: "Vault is locked" },
  },
  VaultInvalidCiphertext: {
    exposure: "ui_only",
    dapp: { code: -32603, message: "Internal error" },
    ui: { message: "Vault data is invalid" },
  },
  VaultInvalidPassword: {
    exposure: "ui_only",
    dapp: { code: 4100, message: "Unauthorized" },
    ui: { message: "Invalid password" },
  },

  KeyringNotInitialized: {
    exposure: "ui_only",
    dapp: { code: -32603, message: "Internal error" },
    ui: { message: "Keyring is not initialized" },
  },
  KeyringInvalidMnemonic: {
    exposure: "ui_only",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Invalid mnemonic" },
  },
  KeyringAccountNotFound: {
    exposure: "ui_only",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Account not found" },
  },
  KeyringDuplicateAccount: {
    exposure: "ui_only",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Duplicate account" },
  },
  KeyringSecretUnavailable: {
    exposure: "ui_only",
    dapp: { code: 4100, message: "Unauthorized" },
    ui: { message: "Secret is unavailable" },
  },
  KeyringIndexOutOfRange: {
    exposure: "ui_only",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Index out of range" },
  },
  KeyringInvalidPrivateKey: {
    exposure: "ui_only",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Invalid private key" },
  },
  KeyringInvalidAddress: {
    exposure: "ui_only",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Invalid address" },
  },

  PermissionNotConnected: {
    exposure: "ui_and_dapp",
    dapp: { code: 4100, message: "Unauthorized" },
    ui: { message: "Not connected" },
  },
  PermissionDenied: {
    exposure: "ui_and_dapp",
    dapp: { code: 4100, message: "Unauthorized" },
    ui: { message: "Permission denied" },
  },

  ApprovalRejected: {
    exposure: "ui_and_dapp",
    dapp: { code: 4001, message: "User rejected the request" },
    ui: { message: "Rejected" },
  },
  ApprovalTimeout: {
    exposure: "ui_and_dapp",
    dapp: { code: 4001, message: "User rejected the request" },
    ui: { message: "Timed out" },
  },
  SessionLocked: {
    exposure: "ui_and_dapp",
    dapp: { code: 4100, message: "Unauthorized" },
    ui: { message: "Session is locked" },
  },

  TransportDisconnected: {
    exposure: "ui_and_dapp",
    dapp: { code: 4900, message: "Disconnected" },
    ui: { message: "Disconnected" },
  },

  ChainNotFound: {
    exposure: "ui_and_dapp",
    dapp: { code: 4902, message: "Unrecognized chain" },
    ui: { message: "Chain not found" },
  },
  ChainNotCompatible: {
    exposure: "ui_and_dapp",
    dapp: { code: 4902, message: "Unrecognized chain" },
    ui: { message: "Chain not compatible" },
  },
  ChainNotSupported: {
    exposure: "ui_and_dapp",
    dapp: { code: 4902, message: "Unrecognized chain" },
    ui: { message: "Chain not supported" },
  },
  ChainInvalidAddress: {
    exposure: "ui_and_dapp",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Invalid address" },
  },

  RpcInvalidRequest: {
    exposure: "ui_and_dapp",
    dapp: { code: -32600, message: "Invalid request" },
    ui: { message: "Invalid request" },
  },
  RpcInvalidParams: {
    exposure: "ui_and_dapp",
    dapp: { code: -32602, message: "Invalid params" },
    ui: { message: "Invalid params" },
  },
  RpcMethodNotFound: {
    exposure: "ui_and_dapp",
    dapp: { code: -32601, message: "Method not found" },
    ui: { message: "Method not found" },
  },
  RpcInternal: {
    exposure: "ui_and_dapp",
    dapp: { code: -32603, message: "Internal error" },
    ui: { message: "Internal error" },
  },
} as const satisfies Record<string, ArxReasonSpec>;

export type ArxReasonKey = keyof typeof ArxErrorSpec;

// Derived reasons map: ArxReasons.VaultLocked === "VaultLocked"
export const ArxReasons = Object.fromEntries(Object.keys(ArxErrorSpec).map((k) => [k, k])) as {
  [K in ArxReasonKey]: K;
};

export type ArxReason = (typeof ArxReasons)[keyof typeof ArxReasons];

export const isArxReason = (value: unknown): value is ArxReason => {
  return typeof value === "string" && Object.hasOwn(ArxErrorSpec, value);
};

