import type { ArxReason } from "./reasons.js";

export type ArxErrorJson = {
  kind: "ArxError";
  reason: ArxReason;
  message: string;
  data?: unknown;
};

export type ArxErrorInput = {
  reason: ArxReason;
  message: string;
  data?: unknown;
  cause?: unknown;
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
    return {
      kind: "ArxError",
      reason: this.reason,
      message: this.message,
      ...(this.data !== undefined ? { data: this.data } : {}),
    };
  }
}

export const arxError = (input: ArxErrorInput): ArxError => new ArxError(input);

export const isArxError = (value: unknown): value is ArxError => {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return candidate.kind === "ArxError" && typeof candidate.reason === "string" && typeof candidate.message === "string";
};
