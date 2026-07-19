import type { JsonRpcParams } from "@metamask/utils";
import { ArxBaseError, type JsonValue, toJsonSafe } from "../errors.js";
import type { RpcEndpoint } from "../networks/types.js";

export type JsonRpcHttpRequest = Readonly<{
  endpoint: RpcEndpoint;
  method: string;
  params?: JsonRpcParams;
  timeoutMs?: number;
}>;

export type JsonRpcHttpTransport = Readonly<{
  request<TResult = unknown>(request: JsonRpcHttpRequest): Promise<TResult>;
}>;

export class ChainJsonRpcHttpProtocolError extends ArxBaseError {
  static readonly code = "chain_json_rpc.http_protocol";

  readonly rpcCode: number;
  readonly rpcData?: JsonValue;

  constructor(input: { rpcCode: number; message: string; data?: unknown }) {
    const rpcData = toJsonSafe(input.data);
    super(input.message, {
      code: ChainJsonRpcHttpProtocolError.code,
      details: {
        rpcCode: input.rpcCode,
        ...(rpcData !== undefined ? { rpcData } : {}),
      },
    });
    this.rpcCode = input.rpcCode;
    if (rpcData !== undefined) this.rpcData = rpcData;
  }
}

export class ChainJsonRpcHttpTransportError extends ArxBaseError {
  static readonly code = "chain_json_rpc.http_transport";

  constructor(message: string, cause?: unknown) {
    super(message, {
      code: ChainJsonRpcHttpTransportError.code,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

const RPC_ID_MAX = 0xffff_ffff;
const DEFAULT_TIMEOUT_MS = 60_000;

const createIdAllocator = () => {
  let next = 0;
  return () => {
    next = next === RPC_ID_MAX ? 0 : next + 1;
    return next;
  };
};

export const createJsonRpcHttpTransport = (
  options: { fetch?: typeof globalThis.fetch; abortController?: () => AbortController } = {},
): JsonRpcHttpTransport => {
  const fetchFn = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchFn) {
    throw new ChainJsonRpcHttpTransportError("JSON-RPC HTTP transport requires fetch.");
  }
  const createAbortController = options.abortController ?? (() => new AbortController());
  const allocateId = createIdAllocator();

  return {
    async request<TResult = unknown>(request: JsonRpcHttpRequest): Promise<TResult> {
      const requestId = allocateId();
      const abortController = createAbortController();
      const timer = setTimeout(() => abortController.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetchFn(request.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method: request.method,
            ...(request.params !== undefined ? { params: request.params } : {}),
          }),
          signal: abortController.signal,
        });

        let body: unknown;
        try {
          body = await response.json();
        } catch (cause) {
          throw new ChainJsonRpcHttpTransportError(
            response.ok ? "RPC endpoint returned invalid JSON." : `RPC endpoint returned HTTP ${response.status}.`,
            cause,
          );
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new ChainJsonRpcHttpTransportError(
            response.ok ? "Invalid JSON-RPC response." : `RPC endpoint returned HTTP ${response.status}.`,
          );
        }

        const envelope = body as {
          jsonrpc?: unknown;
          id?: unknown;
          result?: unknown;
          error?: unknown;
        };
        if (envelope.jsonrpc !== "2.0" || envelope.id !== requestId) {
          throw new ChainJsonRpcHttpTransportError(
            response.ok
              ? "JSON-RPC response does not match the request."
              : `RPC endpoint returned HTTP ${response.status}.`,
          );
        }
        if (envelope.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)) {
          const rpcError = envelope.error as { code?: unknown; message?: unknown; data?: unknown };
          if (typeof rpcError.code === "number" && typeof rpcError.message === "string") {
            throw new ChainJsonRpcHttpProtocolError({
              rpcCode: rpcError.code,
              message: rpcError.message,
              data: rpcError.data,
            });
          }
        }
        if (!response.ok) {
          throw new ChainJsonRpcHttpTransportError(`RPC endpoint returned HTTP ${response.status}.`);
        }
        if (!("result" in envelope)) {
          throw new ChainJsonRpcHttpTransportError("JSON-RPC response is missing a result.");
        }
        return envelope.result as TResult;
      } catch (error) {
        if (error instanceof ChainJsonRpcHttpProtocolError || error instanceof ChainJsonRpcHttpTransportError) {
          throw error;
        }
        throw new ChainJsonRpcHttpTransportError(
          abortController.signal.aborted ? "RPC request timed out." : "RPC request failed.",
          error,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
