import { ArxBaseError, type JsonValue, toJsonSafe } from "../errors.js";

type RequestDetails = {
  chainRef: string;
  method: string;
};

export class ChainJsonRpcResponseError extends ArxBaseError {
  static readonly code = "chain_json_rpc.response_error";

  readonly rpcCode: number;
  readonly rpcData?: JsonValue;

  constructor(input: RequestDetails & { rpcCode: number; message: string; data?: unknown }) {
    const rpcData = toJsonSafe(input.data);
    super(input.message, {
      code: ChainJsonRpcResponseError.code,
      details: {
        chainRef: input.chainRef,
        method: input.method,
        rpcCode: input.rpcCode,
      },
    });
    this.rpcCode = input.rpcCode;
    if (rpcData !== undefined) this.rpcData = rpcData;
  }
}

export class ChainJsonRpcUnavailableError extends ArxBaseError {
  static readonly code = "chain_json_rpc.unavailable";

  constructor(input: RequestDetails & { attempts: number; cause?: unknown }) {
    super("No RPC endpoint completed the request.", {
      code: ChainJsonRpcUnavailableError.code,
      details: { chainRef: input.chainRef, method: input.method, attempts: input.attempts },
      cause: input.cause,
    });
  }
}

export class ChainJsonRpcOutcomeUnknownError extends ArxBaseError {
  static readonly code = "chain_json_rpc.outcome_unknown";

  constructor(input: RequestDetails & { cause?: unknown }) {
    super("The RPC request outcome is unknown and the request was not replayed.", {
      code: ChainJsonRpcOutcomeUnknownError.code,
      details: { chainRef: input.chainRef, method: input.method },
      cause: input.cause,
    });
  }
}
