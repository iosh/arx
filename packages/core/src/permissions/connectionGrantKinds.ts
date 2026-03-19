export const ConnectionGrantKinds = {
  Accounts: "eth_accounts",
} as const;

export type ConnectionGrantKind = (typeof ConnectionGrantKinds)[keyof typeof ConnectionGrantKinds];

export const CONNECTION_GRANT_KIND_VALUES = [ConnectionGrantKinds.Accounts] as const;

const ORDER_INDEX = new Map(CONNECTION_GRANT_KIND_VALUES.map((grantKind, index) => [grantKind, index] as const));

export const sortConnectionGrantKinds = (values: readonly ConnectionGrantKind[]): ConnectionGrantKind[] => {
  const uniq = [...new Set(values)];
  return uniq.sort((a, b) => (ORDER_INDEX.get(a) ?? 999) - (ORDER_INDEX.get(b) ?? 999));
};

export const isConnectionGrantKind = (value: unknown): value is ConnectionGrantKind => {
  return typeof value === "string" && (CONNECTION_GRANT_KIND_VALUES as readonly string[]).includes(value);
};
