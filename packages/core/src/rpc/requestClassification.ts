export const RpcRequestClassifications = {
  AccountsAccess: "accounts_access",
  MessageSigning: "message_signing",
  TransactionSubmission: "transaction_submission",
  ChainManagement: "chain_management",
} as const;

export type RpcRequestClassification = (typeof RpcRequestClassifications)[keyof typeof RpcRequestClassifications];
