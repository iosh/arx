export const UI_NATIVE_BALANCE_QUERY_KEY = ["nativeBalance"] as const;

export const createUiNativeBalanceQueryKey = (params: { chainRef: string | null; accountId: string | null }) =>
  [...UI_NATIVE_BALANCE_QUERY_KEY, params.chainRef, params.accountId] as const;
