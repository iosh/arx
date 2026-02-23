export const PermissionCapabilities = {
  Basic: "wallet_basic",
  Accounts: "eth_accounts",
  Sign: "wallet_sign",
  SendTransaction: "wallet_sendTransaction",
} as const;

export type PermissionCapability = (typeof PermissionCapabilities)[keyof typeof PermissionCapabilities];

// Keep tuple literals for z.enum typing & stable ordering.
export const PERMISSION_CAPABILITY_VALUES = [
  PermissionCapabilities.Basic,
  PermissionCapabilities.Accounts,
  PermissionCapabilities.Sign,
  PermissionCapabilities.SendTransaction,
] as const;

const ORDER_INDEX = new Map(PERMISSION_CAPABILITY_VALUES.map((c, i) => [c, i] as const));

export const sortPermissionCapabilities = (values: readonly PermissionCapability[]): PermissionCapability[] => {
  const uniq = [...new Set(values)];
  return uniq.sort((a, b) => (ORDER_INDEX.get(a) ?? 999) - (ORDER_INDEX.get(b) ?? 999));
};

export const isPermissionCapability = (value: unknown): value is PermissionCapability => {
  return typeof value === "string" && (PERMISSION_CAPABILITY_VALUES as readonly string[]).includes(value);
};
