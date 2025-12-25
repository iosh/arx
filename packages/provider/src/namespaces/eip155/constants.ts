export const DEFAULT_NAMESPACE = "eip155" as const;

export const PROVIDER_INFO = {
  uuid: "90ef60ca-8ea5-4638-b577-6990dc93ef2f",
  name: "ARX Wallet",
  icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgICA8ZGVmcz4KICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImRhcmtTcGFjZSIgeDE9IjAiIHkxPSIwIiB4Mj0iMjAwIiB5Mj0iMjAwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzNBM0EzQSIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwNTA1MDUiLz4KICAgICAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPC9kZWZzPgogICAgPHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIHJ4PSI0NSIgZmlsbD0idXJsKCNkYXJrU3BhY2UpIi8+CiAgICA8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEwMCAzMEw0MCAxNzBINzVMMTAwIDExMEwxMjUgMTcwSDE2MEwxMDAgMzBaTTEwMCA5NUwxMTUgMTM1SDg1TDEwMCA5NVoiIGZpbGw9IiNGRkZGRkYiLz4KPC9zdmc+Cg==",
  rdns: "wallet.arx",
} as const;

export const READONLY_EARLY = new Set(["eth_chainId", "eth_accounts"]);

export const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_NORMAL_TIMEOUT_MS = 120_000;
export const DEFAULT_READONLY_TIMEOUT_MS = 60_000;

export const DEFAULT_READY_TIMEOUT_MS = 10_000;
export const DEFAULT_ETH_ACCOUNTS_WAIT_MS = 200;

export const DEFAULT_APPROVAL_METHODS = new Set<string>([
  "eth_requestAccounts",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
  "wallet_requestPermissions",
  "wallet_watchAsset",
]);

export const DEFAULT_READONLY_METHODS = new Set<string>([
  "eth_chainId",
  "eth_accounts",
  "net_version",
  "web3_clientVersion",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "eth_getTransactionCount",
  "eth_getLogs",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
]);
