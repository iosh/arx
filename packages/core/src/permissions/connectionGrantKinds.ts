/**
 * Grant kinds persisted in permission records.
 *
 * These values describe connection scope only. Request-level signing and
 * transaction approvals remain runtime state.
 */
export const ConnectionGrantKinds = {
  Accounts: "eth_accounts",
} as const;

export type ConnectionGrantKind = (typeof ConnectionGrantKinds)[keyof typeof ConnectionGrantKinds];
