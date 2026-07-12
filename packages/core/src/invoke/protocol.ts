import { ArxBaseError, type SerializedArxError } from "../errors.js";

export type InvokeChannel = {
  connect(): Promise<void>;
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onDisconnect?(listener: (error?: unknown) => void): () => void;
  disconnect?(): void;
};

export type InvokeRequest = {
  kind: "invoke";
  target: string;
  id: string;
  action: string;
  input?: unknown;
};

export type InvokeResult = {
  kind: "result";
  target: string;
  id: string;
  output: unknown;
};

export type InvokeFailure = {
  kind: "failure";
  target: string;
  id: string;
  error: SerializedArxError;
};

export type InvokeEvent = {
  kind: "event";
  target: string;
  name: string;
  payload: unknown;
};

export type InvokeReady = {
  kind: "ready";
};

export type InvokeMessage = InvokeResult | InvokeFailure | InvokeEvent;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const isSerializedArxError = (value: unknown): value is SerializedArxError => {
  return (
    isRecord(value) &&
    value.kind === "ArxError" &&
    typeof value.name === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
};

class InvokeMessageShapeError extends ArxBaseError {
  static readonly code = "invoke.message_shape";

  constructor(messageKind: "result" | "failure" | "event") {
    super(`Malformed ${messageKind} invoke message.`, {
      code: InvokeMessageShapeError.code,
      details: { messageKind },
    });
  }
}

export const isInvokeRequest = (value: unknown): value is InvokeRequest => {
  return (
    isRecord(value) &&
    value.kind === "invoke" &&
    typeof value.target === "string" &&
    value.target.length > 0 &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.action === "string" &&
    value.action.length > 0
  );
};

export const isInvokeReady = (value: unknown): value is InvokeReady => {
  return isRecord(value) && value.kind === "ready";
};

export const readInvokeMessage = (value: unknown): InvokeMessage | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "ready") {
    return null;
  }

  if (value.kind === "result") {
    if (typeof value.target !== "string" || typeof value.id !== "string") {
      throw new InvokeMessageShapeError("result");
    }

    return value as InvokeResult;
  }

  if (value.kind === "failure") {
    if (typeof value.target !== "string" || typeof value.id !== "string" || !isSerializedArxError(value.error)) {
      throw new InvokeMessageShapeError("failure");
    }

    return value as InvokeFailure;
  }

  if (value.kind === "event") {
    if (typeof value.target !== "string" || typeof value.name !== "string") {
      throw new InvokeMessageShapeError("event");
    }

    return value as InvokeEvent;
  }

  return null;
};
