import { ArxBaseError, type JsonObject, type JsonValue, toJsonSafe } from "../errors.js";

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

export class RpcUnauthorizedError extends ArxBaseError {
  static readonly code = "global.rpc.unauthorized";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "The requested account and/or method has not been authorized by the user.", {
      code: RpcUnauthorizedError.code,
      details: input.details,
    });
  }
}

export class RpcUserRejectedRequestError extends ArxBaseError {
  static readonly code = "global.rpc.user_rejected_request";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "User rejected the request.", {
      code: RpcUserRejectedRequestError.code,
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

export class RpcUnrecognizedChainError extends ArxBaseError {
  static readonly code = "global.rpc.unrecognized_chain";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Unrecognized chain.", {
      code: RpcUnrecognizedChainError.code,
      details: input.details,
    });
  }
}

export class RpcChainUnavailableError extends ArxBaseError {
  static readonly code = "global.rpc.chain_unavailable";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "The requested chain is currently unavailable.", {
      code: RpcChainUnavailableError.code,
      details: input.details,
    });
  }
}

export class RpcOutcomeUnknownError extends ArxBaseError {
  static readonly code = "global.rpc.outcome_unknown";

  constructor(input: RpcErrorInput = {}) {
    super(input.message ?? "Request outcome is unknown.", {
      code: RpcOutcomeUnknownError.code,
      details: input.details,
    });
  }
}

export class RpcJsonRpcResponseError extends ArxBaseError {
  static readonly code = "global.rpc.json_rpc_response";

  readonly rpcCode: number;
  readonly rpcData?: JsonValue;

  constructor(input: { rpcCode: number; message: string; data?: unknown }) {
    const rpcData = toJsonSafe(input.data);
    super(input.message, {
      code: RpcJsonRpcResponseError.code,
      details: {
        rpcCode: input.rpcCode,
        ...(rpcData !== undefined ? { rpcData } : {}),
      },
    });
    this.rpcCode = input.rpcCode;
    if (rpcData !== undefined) this.rpcData = rpcData;
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

export const createRpcInternalErrorFromUnknown = (error: unknown): RpcInternalError => {
  return new RpcInternalError({ cause: error });
};
