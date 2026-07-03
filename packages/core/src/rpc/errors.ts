import { ArxBaseError, type ErrorCause, type JsonObject, type JsonValue, toJsonSafe } from "../error.js";
import type { JsonRpcErrorLike } from "./jsonRpcError.js";

export { isJsonRpcErrorLike } from "./jsonRpcError.js";

export type RpcErrorInput = ErrorCause & {
  message?: string;
  details?: JsonObject | undefined;
};

export class RpcInvalidRequestError extends ArxBaseError {
  static readonly code = "global.rpc.invalid_request";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Invalid request.", {
      code: RpcInvalidRequestError.code,
      details: input.details,
      cause: input.cause,
    });
  }
}

export class RpcInvalidParamsError extends ArxBaseError {
  static readonly code = "global.rpc.invalid_params";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Invalid params.", {
      code: RpcInvalidParamsError.code,
      details: input.details,
      cause: input.cause,
    });
  }
}

export class RpcUnsupportedMethodError extends ArxBaseError {
  static readonly code = "global.rpc.unsupported_method";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Unsupported method.", {
      code: RpcUnsupportedMethodError.code,
      details: input.details,
      cause: input.cause,
    });
  }
}

export class RpcInternalError extends ArxBaseError {
  static readonly code = "global.rpc.internal";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Internal error.", {
      code: RpcInternalError.code,
      details: input.details,
      cause: input.cause,
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
