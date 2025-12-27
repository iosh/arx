export type RpcErrorPayload = { message?: string; data?: unknown };
export type ProviderErrorPayload = { message?: string; data?: unknown };
export type ProviderCustomPayload = { code: number; message: string; data?: unknown };

export type RpcErrorInstance = Error & { code: number; data?: unknown };
export type ProviderErrorInstance = Error & { code: number; data?: unknown };

export type RpcErrorFactory = {
  parse(args?: RpcErrorPayload): RpcErrorInstance;
  invalidRequest(args?: RpcErrorPayload): RpcErrorInstance;
  invalidParams(args?: RpcErrorPayload): RpcErrorInstance;
  methodNotFound(args?: RpcErrorPayload): RpcErrorInstance;
  internal(args?: RpcErrorPayload): RpcErrorInstance;
};

export type ProviderErrorFactory = {
  disconnected(args?: ProviderErrorPayload): ProviderErrorInstance;
  chainDisconnected(args?: ProviderErrorPayload): ProviderErrorInstance;
  unauthorized(args?: ProviderErrorPayload): ProviderErrorInstance;
  userRejectedRequest(args?: ProviderErrorPayload): ProviderErrorInstance;
  unsupportedMethod(args?: ProviderErrorPayload): ProviderErrorInstance;
  custom(args: ProviderCustomPayload): ProviderErrorInstance;
};

const errorCodes = {
  rpc: {
    parse: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603,
  },
  provider: {
    userRejectedRequest: 4001,
    unauthorized: 4100,
    unsupportedMethod: 4200,
    disconnected: 4900,
    chainDisconnected: 4901,
  },
} as const;

const defaultMessageByCode = new Map<number, string>([
  [
    errorCodes.rpc.parse,
    "Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.",
  ],
  [errorCodes.rpc.invalidRequest, "The JSON sent is not a valid Request object."],
  [errorCodes.rpc.methodNotFound, "The method does not exist / is not available."],
  [errorCodes.rpc.invalidParams, "Invalid method parameter(s)."],
  [errorCodes.rpc.internal, "Internal JSON-RPC error."],
  [errorCodes.provider.userRejectedRequest, "User rejected the request."],
  [errorCodes.provider.unauthorized, "The requested account and/or method has not been authorized by the user."],
  [errorCodes.provider.unsupportedMethod, "The requested method is not supported by this Ethereum provider."],
  [errorCodes.provider.disconnected, "The provider is disconnected from all chains."],
  [errorCodes.provider.chainDisconnected, "The provider is disconnected from the specified chain."],
]);

const makeError = (
  code: number,
  payload?: { message?: string; data?: unknown },
): Error & { code: number; data?: unknown } => {
  const message = payload?.message ?? defaultMessageByCode.get(code) ?? "Unknown error";
  const error = new Error(message) as Error & { code: number; data?: unknown };
  error.code = code;
  if (payload && "data" in payload && payload.data !== undefined) {
    error.data = payload.data;
  }
  return error;
};

export const createEvmRpcErrors = (): RpcErrorFactory => ({
  parse: (args) => makeError(errorCodes.rpc.parse, args),
  invalidRequest: (args) => makeError(errorCodes.rpc.invalidRequest, args),
  invalidParams: (args) => makeError(errorCodes.rpc.invalidParams, args),
  methodNotFound: (args) => makeError(errorCodes.rpc.methodNotFound, args),
  internal: (args) => makeError(errorCodes.rpc.internal, args),
});

export const createEvmProviderErrors = (): ProviderErrorFactory => ({
  disconnected: (args) => makeError(errorCodes.provider.disconnected, args),
  chainDisconnected: (args) => makeError(errorCodes.provider.chainDisconnected, args),
  unauthorized: (args) => makeError(errorCodes.provider.unauthorized, args),
  userRejectedRequest: (args) => makeError(errorCodes.provider.userRejectedRequest, args),
  unsupportedMethod: (args) => makeError(errorCodes.provider.unsupportedMethod, args),
  custom: (args) => makeError(args.code, args),
});

export const evmRpcErrors = createEvmRpcErrors();
export const evmProviderErrors = createEvmProviderErrors();
