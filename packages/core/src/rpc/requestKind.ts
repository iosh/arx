export const RpcRequestKinds = {
  AccountAccess: "account_access",
  MessageSigning: "message_signing",
  ChainManagement: "chain_management",
} as const;

export type RpcRequestKind = (typeof RpcRequestKinds)[keyof typeof RpcRequestKinds];
