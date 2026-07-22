export type ProviderJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ProviderJsonValue[]
  | Readonly<{ [key: string]: ProviderJsonValue }>;

export type ProviderRpcParams = readonly ProviderJsonValue[] | Readonly<{ [key: string]: ProviderJsonValue }>;

export type ProviderRpcError =
  | Readonly<{
      kind: "ArxError";
      code: string;
    }>
  | Readonly<{
      kind: "JsonRpcError";
      code: number;
      message: string;
      data?: ProviderJsonValue;
    }>;

export type ProviderRpcRequest = {
  method: string;
  params?: ProviderRpcParams;
};
export type ProviderRpcResponse =
  | {
      result: unknown;
    }
  | {
      error: ProviderRpcError;
    };
