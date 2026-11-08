import { ArxBaseError, type JsonValue } from "../errors.js";

export class ChainJsonRpcResponseError extends ArxBaseError {
  static readonly code = "chain_json_rpc.response_error";

  readonly rpcCode: number;
  readonly rpcData?: JsonValue;

  constructor(input: { rpcCode: number; message: string; data?: JsonValue | undefined }) {
    const rpcData = input.data;
    super(input.message, {
      code: ChainJsonRpcResponseError.code,
      details: {
        rpcCode: input.rpcCode,
        ...(rpcData !== undefined ? { rpcData } : {}),
      },
    });
    this.rpcCode = input.rpcCode;
    if (rpcData !== undefined) this.rpcData = rpcData;
  }
}

export class ChainJsonRpcUnavailableError extends ArxBaseError {
  static readonly code = "chain_json_rpc.unavailable";

  constructor(cause?: unknown) {
    super("No RPC endpoint completed the request.", {
      code: ChainJsonRpcUnavailableError.code,
      cause,
    });
  }
}

export class ChainJsonRpcOutcomeUnknownError extends ArxBaseError {
  static readonly code = "chain_json_rpc.outcome_unknown";

  constructor(cause?: unknown) {
    super("The RPC request outcome is unknown and the request was not replayed.", {
      code: ChainJsonRpcOutcomeUnknownError.code,
      cause,
    });
  }
}
