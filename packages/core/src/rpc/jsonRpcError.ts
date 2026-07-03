export type JsonRpcErrorLike = {
  code: number;
  message?: unknown;
  data?: unknown;
};

export class JsonRpcResponseError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(params: { code: number; message: string; data?: unknown }) {
    super(params.message);
    this.name = "JsonRpcResponseError";
    this.code = params.code;
    if (params.data !== undefined) {
      this.data = params.data;
    }
  }
}

export const isJsonRpcErrorLike = (value: unknown): value is JsonRpcErrorLike => {
  if (value instanceof JsonRpcResponseError) return true;
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;

  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "number";
};
