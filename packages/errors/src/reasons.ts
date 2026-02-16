export const ArxReasons = {
  VaultNotInitialized: "vault/not_initialized",
  VaultLocked: "vault/locked",
  VaultInvalidCiphertext: "vault/invalid_ciphertext",
  VaultInvalidPassword: "vault/invalid_password",

  KeyringNotInitialized: "keyring/not_initialized",
  KeyringInvalidMnemonic: "keyring/invalid_mnemonic",
  KeyringAccountNotFound: "keyring/account_not_found",
  KeyringDuplicateAccount: "keyring/duplicate_account",
  KeyringSecretUnavailable: "keyring/secret_unavailable",
  KeyringIndexOutOfRange: "keyring/index_out_of_range",
  KeyringInvalidPrivateKey: "keyring/invalid_private_key",
  KeyringInvalidAddress: "keyring/invalid_address",

  PermissionNotConnected: "permission/not_connected",
  PermissionDenied: "permission/denied",

  ApprovalRejected: "approval/rejected",
  SessionLocked: "session/locked",

  TransportDisconnected: "transport/disconnected",

  ChainNotFound: "chain/not_found",
  ChainNotCompatible: "chain/not_compatible",
  ChainNotSupported: "chain/not_supported",
  ChainInvalidAddress: "chain/invalid_address",

  RpcInvalidRequest: "rpc/invalid_request",
  RpcInvalidParams: "rpc/invalid_params",
  RpcMethodNotFound: "rpc/method_not_found",
  RpcInternal: "rpc/internal",
} as const;

export type ArxReason = (typeof ArxReasons)[keyof typeof ArxReasons];
