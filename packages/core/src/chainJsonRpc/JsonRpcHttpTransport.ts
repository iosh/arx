import type { JsonRpcParams } from "@metamask/utils";
import type { RpcEndpoint } from "../chains/definition.js";

export type JsonRpcHttpRequest = {
  method: string;
  params?: JsonRpcParams;
  id: string | number;
  timeoutMs: number;
};

export type JsonRpcHttpTransport = {
  request(endpoint: RpcEndpoint, request: JsonRpcHttpRequest): Promise<unknown>;
};

export class JsonRpcProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcProtocolError";
  }
}

export class JsonRpcTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JsonRpcTransportError";
  }
}

export const createJsonRpcHttpTransport = (
  options: { fetch?: typeof globalThis.fetch; abortController?: () => AbortController } = {},
): JsonRpcHttpTransport => {
  const fetchFn = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchFn) throw new Error("JSON-RPC HTTP transport requires fetch.");
  const createAbortController = options.abortController ?? (() => new AbortController());

  return {
    async request(endpoint, request) {
      const abortController = createAbortController();
      const timer = setTimeout(() => abortController.abort(), request.timeoutMs);
      try {
        const response = await fetchFn(endpoint.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(endpoint.headers ?? {}) },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            method: request.method,
            ...(request.params !== undefined ? { params: request.params } : {}),
          }),
          signal: abortController.signal,
        });

        let body: unknown;
        try {
          body = await response.json();
        } catch (cause) {
          throw new JsonRpcTransportError(
            response.ok ? "RPC endpoint returned invalid JSON." : `RPC endpoint returned HTTP ${response.status}.`,
            { cause },
          );
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new JsonRpcTransportError(
            response.ok ? "Invalid JSON-RPC response." : `RPC endpoint returned HTTP ${response.status}.`,
          );
        }
        const envelope = body as {
          jsonrpc?: unknown;
          id?: unknown;
          result?: unknown;
          error?: unknown;
        };
        if (envelope.jsonrpc !== "2.0" || envelope.id !== request.id) {
          throw new JsonRpcTransportError(
            response.ok
              ? "JSON-RPC response does not match the request."
              : `RPC endpoint returned HTTP ${response.status}.`,
          );
        }
        if (envelope.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)) {
          const rpcError = envelope.error as { code?: unknown; message?: unknown; data?: unknown };
          if (typeof rpcError.code === "number" && typeof rpcError.message === "string") {
            throw new JsonRpcProtocolError(rpcError.code, rpcError.message, rpcError.data);
          }
        }
        if (!response.ok) throw new JsonRpcTransportError(`RPC endpoint returned HTTP ${response.status}.`);
        if (!("result" in envelope)) throw new JsonRpcTransportError("JSON-RPC response is missing a result.");
        return envelope.result;
      } catch (error) {
        if (error instanceof JsonRpcProtocolError || error instanceof JsonRpcTransportError) throw error;
        throw new JsonRpcTransportError(
          abortController.signal.aborted ? "RPC request timed out." : "RPC request failed.",
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
