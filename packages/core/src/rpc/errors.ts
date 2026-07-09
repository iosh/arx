import { ArxBaseError, type JsonObject, type JsonValue, toJsonSafe } from "../error.js";
import type { JsonRpcErrorLike } from "./jsonRpcError.js";

export { isJsonRpcErrorLike } from "./jsonRpcError.js";

export type RpcErrorInput = {
  message?: string;
  details?: JsonObject | undefined;
};

type RpcInternalErrorInput = RpcErrorInput & {
  cause?: unknown;
};

export class RpcInvalidRequestError extends ArxBaseError {
  static readonly code = "global.rpc.invalid_request";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Invalid request.", {
      code: RpcInvalidRequestError.code,
      details: input.details,
    });
  }
}

export class RpcInvalidParamsError extends ArxBaseError {
  static readonly code = "global.rpc.invalid_params";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Invalid params.", {
      code: RpcInvalidParamsError.code,
      details: input.details,
    });
  }
}

export class RpcUnsupportedMethodError extends ArxBaseError {
  static readonly code = "global.rpc.unsupported_method";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Unsupported method.", {
      code: RpcUnsupportedMethodError.code,
      details: input.details,
    });
  }
}

export class RpcInternalError extends ArxBaseError {
  static readonly code = "global.rpc.internal";

  constructor(input: RpcInternalErrorInput = {}) {
    super(input.message ?? "Internal error.", {
      code: RpcInternalError.code,
      details: input.details,
      cause: input.cause,
    });
  }
}

export type RpcClientPoolConfigErrorInput = {
  reason: "missing_fetch" | "missing_namespace" | "missing_chain_ref" | "namespace_mismatch" | "missing_factory";
  namespace?: string;
  chainRef?: string;
  actualNamespace?: string;
};

export class RpcClientPoolConfigError extends ArxBaseError {
  static readonly code = "global.rpc.client_pool_config_invalid";

  constructor(input: RpcClientPoolConfigErrorInput) {
    super("RPC client pool configuration is invalid.", {
      code: RpcClientPoolConfigError.code,
      details: {
        reason: input.reason,
        ...(input.namespace ? { namespace: input.namespace } : {}),
        ...(input.chainRef ? { chainRef: input.chainRef } : {}),
        ...(input.actualNamespace ? { actualNamespace: input.actualNamespace } : {}),
      },
    });
  }
}

export const sanitizeJsonRpcErrorObject = (
  error: JsonRpcErrorLike,
): { code: number; message: string; data?: JsonValue } => {
  const data = toJsonSafe(error.data);
  return {
    code: error.code,
    message: typeof error.message === "string" && error.message.length > 0 ? error.message : "Unknown error",
    ...(data !== undefined ? { data } : {}),
  };
};

export const createRpcInternalErrorFromUnknown = (error: unknown): RpcInternalError => {
  return new RpcInternalError({ cause: error });
};
