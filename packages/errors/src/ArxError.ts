import type { JsonValue } from "./json.js";
import { toJsonSafe } from "./json.js";
import type { ArxReason } from "./spec.js";
import { isArxReason } from "./spec.js";

export type ArxErrorJson = {
  kind: "ArxError";
  reason: ArxReason;
  message: string;
  data?: JsonValue;
};

export type ArxErrorInput = {
  reason: ArxReason;
  message: string;
  data?: unknown;
  cause?: unknown;
};

export type ArxErrorLike = {
  kind: "ArxError";
  reason: unknown;
  message: unknown;
  data?: unknown;
};

export class ArxError extends Error {
  readonly kind = "ArxError" as const;
  readonly reason: ArxReason;
  readonly data?: unknown;

  constructor(input: ArxErrorInput) {
    super(input.message, input.cause !== undefined ? { cause: input.cause } : undefined);
    this.name = "ArxError";
    this.reason = input.reason;
    this.data = input.data;
  }

  toJSON(): ArxErrorJson {
    const safeData = toJsonSafe(this.data);
    return {
      kind: "ArxError",
      reason: this.reason,
      message: this.message,
      ...(safeData !== undefined ? { data: safeData } : {}),
    };
  }
}

export const arxError = (input: ArxErrorInput): ArxError => new ArxError(input);

export const isArxError = (value: unknown): value is ArxError => {
  return value instanceof ArxError;
};

export const isArxErrorLike = (value: unknown): value is ArxErrorLike => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "ArxError";
};

export const coerceArxError = (value: unknown): ArxError | null => {
  if (value instanceof ArxError) return value;
  if (!isArxErrorLike(value)) return null;

  const reason = (value as ArxErrorLike).reason;
  const message = (value as ArxErrorLike).message;
  if (!isArxReason(reason) || typeof message !== "string") return null;

  return arxError({
    reason,
    message,
    data: (value as ArxErrorLike).data,
    cause: value,
  });
};
