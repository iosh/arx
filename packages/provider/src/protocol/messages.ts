export type ProviderJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ProviderJsonValue[]
  | Readonly<{ [key: string]: ProviderJsonValue }>;

export type DappRequestParams = readonly ProviderJsonValue[] | Readonly<{ [key: string]: ProviderJsonValue }>;

export type ProviderConnection = Readonly<{
  chainRef: string;
  accounts: readonly string[];
}>;

export const DAPP_ERROR_KINDS = [
  "invalid_request",
  "invalid_params",
  "unauthorized",
  "user_rejected",
  "unsupported_method",
  "unrecognized_chain",
  "chain_unavailable",
  "json_rpc_response",
  "internal",
  "disconnected",
] as const;

export type DappErrorKind = (typeof DAPP_ERROR_KINDS)[number];

type NonJsonRpcResponseDappErrorKind = Exclude<DappErrorKind, "json_rpc_response">;

export type SerializedDappError =
  | Readonly<{
      kind: "json_rpc_response";
      message: string;
      data: Readonly<{
        code: number;
        data?: ProviderJsonValue;
      }>;
    }>
  | {
      [Kind in NonJsonRpcResponseDappErrorKind]: Readonly<{
        kind: Kind;
        message: string;
      }>;
    }[NonJsonRpcResponseDappErrorKind];

type DisconnectedError = Extract<SerializedDappError, { kind: "disconnected" }>;

export type PageToWalletMessage =
  | Readonly<{
      type: "open";
      namespace: string;
    }>
  | Readonly<{
      type: "request";
      namespace: string;
      id: number;
      method: string;
      params?: DappRequestParams;
    }>;

export type WalletToPageMessage =
  | Readonly<{
      type: "opened";
      namespace: string;
      connection: ProviderConnection;
    }>
  | Readonly<{
      type: "open_failed";
      namespace: string;
      error: SerializedDappError;
    }>
  | Readonly<{
      type: "success";
      namespace: string;
      id: number;
      result: unknown;
    }>
  | Readonly<{
      type: "failure";
      namespace: string;
      id: number;
      error: SerializedDappError;
    }>
  | Readonly<{
      type: "connection_changed";
      namespace: string;
      connection: ProviderConnection;
    }>
  | Readonly<{
      type: "transport_disconnected";
      error: DisconnectedError;
    }>;
