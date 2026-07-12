export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [k: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export const ARX_ERROR_KIND = "ArxError" as const;

export type ArxErrorDetails = JsonObject;

export type SerializedArxError = {
  kind: typeof ARX_ERROR_KIND;
  name: string;
  code: string;
  message: string;
  details?: ArxErrorDetails;
};

export abstract class ArxBaseError extends Error {
  readonly kind = ARX_ERROR_KIND;
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

  toJSON(): SerializedArxError {
    return serializeArxError(this);
  }
}

export const isArxBaseError = (value: unknown): value is ArxBaseError => {
  return value instanceof ArxBaseError;
};

export const serializeArxError = (error: ArxBaseError): SerializedArxError => {
  return {
    kind: ARX_ERROR_KIND,
    name: error.name,
    code: error.code,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
};

class DeserializedArxError extends ArxBaseError {
  static readonly code = "error.deserialized";

  constructor(error: SerializedArxError) {
    super(error.message, {
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
    this.name = error.name;
  }
}

export const deserializeArxError = (error: SerializedArxError): ArxBaseError => {
  return new DeserializedArxError(error);
};

export const toJsonSafe = (value: unknown): JsonValue | undefined => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
};
