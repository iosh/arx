export const PermissionScopes = {
  Basic: "wallet_basic",
  Accounts: "wallet_accounts",
  Sign: "wallet_sign",
  Transaction: "wallet_transaction",
} as const;

// Keep tuple literals for z.enum typing & stable ordering.
export const PERMISSION_SCOPE_VALUES = [
  PermissionScopes.Basic,
  PermissionScopes.Accounts,
  PermissionScopes.Sign,
  PermissionScopes.Transaction,
] as const;

export const ApprovalTypes = {
  RequestAccounts: "wallet_requestAccounts",
  RequestPermissions: "wallet_requestPermissions",
  SignMessage: "wallet_signMessage",
  SignTypedData: "wallet_signTypedData",
  SendTransaction: "wallet_sendTransaction",
  AddChain: "wallet_addEthereumChain",
} as const;

export const APPROVAL_TYPE_VALUES = [
  ApprovalTypes.RequestAccounts,
  ApprovalTypes.RequestPermissions,
  ApprovalTypes.SignMessage,
  ApprovalTypes.SignTypedData,
  ApprovalTypes.SendTransaction,
  ApprovalTypes.AddChain,
] as const;
