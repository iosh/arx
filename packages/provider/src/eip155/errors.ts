import type { DappErrorKind, ProviderJsonValue, SerializedDappError } from "../protocol/messages.js";

export type ProviderRpcErrorInput = Readonly<{
  code: number;
  message: string;
  data?: ProviderJsonValue;
}>;

export class ProviderRpcError extends Error {
  readonly code: number;
  readonly data: ProviderJsonValue | undefined;

  constructor(input: ProviderRpcErrorInput) {
    super(input.message);
    this.name = new.target.name;
    this.code = input.code;
    this.data = input.data;
  }
}

const ERROR_CODE_BY_KIND: Readonly<Record<Exclude<DappErrorKind, "upstream_response">, number>> = {
  invalid_request: -32600,
  invalid_params: -32602,
  internal: -32603,
  user_rejected: 4001,
  unauthorized: 4100,
  unsupported_method: 4200,
  disconnected: 4900,
  unrecognized_network: 4902,
};

export const invalidProviderRequestError = (): ProviderRpcError =>
  new ProviderRpcError({
    code: -32600,
    message: "Invalid EIP-1193 request arguments.",
  });

export const disconnectedProviderRequestError = (message = "The provider is disconnected."): ProviderRpcError =>
  new ProviderRpcError({ code: 4900, message });

export const providerDisconnectEventError = (message: string): ProviderRpcError =>
  new ProviderRpcError({ code: 1013, message });

export const toProviderRpcError = (error: SerializedDappError): ProviderRpcError => {
  if (error.kind !== "upstream_response") {
    return new ProviderRpcError({
      code: ERROR_CODE_BY_KIND[error.kind],
      message: error.message,
    });
  }

  return new ProviderRpcError({
    code: error.data.code,
    message: error.message,
    ...(error.data.data === undefined ? {} : { data: error.data.data }),
  });
};
