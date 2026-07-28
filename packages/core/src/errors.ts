export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [k: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export type ArxErrorDetails = JsonObject;

export abstract class ArxBaseError extends Error {
  readonly code: string;
  readonly details: ArxErrorDetails | undefined;

  protected constructor(
    message: string,
    input: { code: string; details?: ArxErrorDetails | undefined; cause?: unknown },
  ) {
    super(message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = new.target.name;
    this.code = input.code;
    this.details = input.details;
  }
}

export const isArxBaseError = (value: unknown): value is ArxBaseError => {
  return value instanceof ArxBaseError;
};

export const toJsonSafe = (value: unknown): JsonValue | undefined => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
};
