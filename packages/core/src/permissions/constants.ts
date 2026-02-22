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
