const ARX_REASON_KEYS = [
  "VaultNotInitialized",
  "VaultLocked",
  "VaultInvalidCiphertext",
  "VaultInvalidPassword",
  "KeyringNotInitialized",
  "KeyringInvalidMnemonic",
  "KeyringAccountNotFound",
  "KeyringDuplicateAccount",
  "KeyringSecretUnavailable",
  "KeyringIndexOutOfRange",
  "KeyringInvalidPrivateKey",
  "KeyringInvalidAddress",
  "PermissionNotConnected",
  "PermissionDenied",
  "ApprovalRejected",
  "ApprovalTimeout",
  "SessionLocked",
  "TransportDisconnected",
  "ChainNotFound",
  "ChainNotCompatible",
  "ChainNotSupported",
  "ChainInvalidAddress",
  "RpcInvalidRequest",
  "RpcInvalidParams",
  "RpcMethodNotFound",
  "RpcUnsupportedMethod",
  "RpcInternal",
] as const;

export type ArxReasonKey = (typeof ARX_REASON_KEYS)[number];

// Derived reasons map: ArxReasons.VaultLocked === "VaultLocked"
export const ArxReasons = Object.fromEntries(ARX_REASON_KEYS.map((key) => [key, key])) as {
  [K in ArxReasonKey]: K;
};

export type ArxReason = (typeof ArxReasons)[ArxReasonKey];

const arxReasonSet = new Set<string>(ARX_REASON_KEYS);

export const isArxReason = (value: unknown): value is ArxReason => {
  return typeof value === "string" && arxReasonSet.has(value);
};
