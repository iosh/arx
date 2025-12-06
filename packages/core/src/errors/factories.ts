import { providerErrors as metamaskProviderErrors, rpcErrors as metamaskRpcErrors } from "@metamask/rpc-errors";
import type { JsonRpcError } from "@metamask/utils";

export type RpcErrorPayload = { message: string; data?: unknown };
export type ProviderErrorPayload = { message: string; data?: unknown };
export type ProviderCustomPayload = { code: number; message: string; data?: unknown };

export type RpcErrorInstance = Error & { code: number; message: string; data?: unknown; serialize: () => JsonRpcError };
export type ProviderErrorInstance = Error & {
  code: number;
  message: string;
  data?: unknown;
  serialize: () => JsonRpcError;
};

export type RpcErrorFactory = {
  parse(args: RpcErrorPayload): RpcErrorInstance;
  invalidRequest(args: RpcErrorPayload): RpcErrorInstance;
  invalidParams(args: RpcErrorPayload): RpcErrorInstance;
  methodNotFound(args?: RpcErrorPayload): RpcErrorInstance;
  resourceNotFound(args?: RpcErrorPayload): RpcErrorInstance;
  resourceUnavailable(args?: RpcErrorPayload): RpcErrorInstance;
  limitExceeded(args: RpcErrorPayload): RpcErrorInstance;
  internal(args: RpcErrorPayload): RpcErrorInstance;
};

export type ProviderErrorFactory = {
  disconnected(): ProviderErrorInstance;
  chainDisconnected(args: ProviderErrorPayload): ProviderErrorInstance;
  unauthorized(args: ProviderErrorPayload): ProviderErrorInstance;
  userRejectedRequest(args: ProviderErrorPayload): ProviderErrorInstance;
  custom(args: ProviderCustomPayload): ProviderErrorInstance;
};
export type ChainErrorFactory = {
  rpc?: RpcErrorFactory;
  provider?: ProviderErrorFactory;
};

const toMetamaskArgs = <T extends RpcErrorPayload | ProviderErrorPayload>(args: T) =>
  args as Parameters<typeof metamaskRpcErrors.invalidRequest>[0];

export const createEvmRpcErrors = (): RpcErrorFactory => ({
  parse: (args) => metamaskRpcErrors.parse(toMetamaskArgs(args)),
  invalidRequest: (args) => metamaskRpcErrors.invalidRequest(toMetamaskArgs(args)),
  invalidParams: (args) => metamaskRpcErrors.invalidParams(toMetamaskArgs(args)),
  methodNotFound: (args) =>
    args ? metamaskRpcErrors.methodNotFound(toMetamaskArgs(args)) : metamaskRpcErrors.methodNotFound(),
  resourceNotFound: (args) =>
    args ? metamaskRpcErrors.resourceNotFound(toMetamaskArgs(args)) : metamaskRpcErrors.resourceNotFound(),
  resourceUnavailable: (args) =>
    args ? metamaskRpcErrors.resourceUnavailable(toMetamaskArgs(args)) : metamaskRpcErrors.resourceUnavailable(),
  limitExceeded: (args) => metamaskRpcErrors.limitExceeded(toMetamaskArgs(args)),
  internal: (args) => metamaskRpcErrors.internal(toMetamaskArgs(args)),
});

const toProviderArgs = <T extends ProviderErrorPayload>(args: T) =>
  args as Parameters<typeof metamaskProviderErrors.unauthorized>[0];

export const createEvmProviderErrors = (): ProviderErrorFactory => ({
  disconnected: () => metamaskProviderErrors.disconnected(),
  chainDisconnected: (args) => metamaskProviderErrors.chainDisconnected(toProviderArgs(args)),
  unauthorized: (args) => metamaskProviderErrors.unauthorized(toProviderArgs(args)),
  userRejectedRequest: (args) => metamaskProviderErrors.userRejectedRequest(toProviderArgs(args)),
  custom: (args) => metamaskProviderErrors.custom(args as Parameters<typeof metamaskProviderErrors.custom>[0]),
});
