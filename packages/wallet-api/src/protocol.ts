import type { WalletApiEvent } from "@arx/core/wallet";
import type { SerializedWalletApiError } from "./errors.js";

export type WalletRequestMessage = Readonly<{
  type: "request";
  id: number;
  method: string;
  input?: unknown;
}>;

export type WalletSuccessMessage = Readonly<{
  type: "success";
  id: number;
  result?: unknown;
}>;

export type WalletFailureMessage = Readonly<{
  type: "failure";
  id: number;
  error: SerializedWalletApiError;
}>;

export type WalletEventMessage = Readonly<{
  type: "event";
  event: WalletApiEvent;
}>;

export type WalletResponseMessage = WalletSuccessMessage | WalletFailureMessage;
export type WalletHostMessage = WalletResponseMessage | WalletEventMessage;

export const formatWalletMethodPath = (segments: readonly string[]): string => segments.join(".");

type MessageRecord = Record<string, unknown>;
type SerializedErrorDetails = NonNullable<SerializedWalletApiError["details"]>;

const isRecord = (value: unknown): value is MessageRecord => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

const isRequestId = (value: unknown): value is number => {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
};

const parseErrorDetails = (value: unknown): SerializedErrorDetails | undefined | null => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return null;
  }

  return value as SerializedErrorDetails;
};

const parseSerializedWalletApiError = (value: unknown): SerializedWalletApiError | null => {
  if (!isRecord(value) || !isNonEmptyString(value.code) || !isNonEmptyString(value.message)) {
    return null;
  }

  const details = parseErrorDetails(value.details);
  if (details === null) {
    return null;
  }

  if (details === undefined) {
    return { code: value.code, message: value.message };
  }

  return { code: value.code, message: value.message, details };
};

const parseWalletSuccess = (value: MessageRecord): WalletSuccessMessage | null => {
  if (!isRequestId(value.id)) {
    return null;
  }

  if (value.result === undefined) {
    return { type: "success", id: value.id };
  }

  return { type: "success", id: value.id, result: value.result };
};

const parseWalletFailure = (value: MessageRecord): WalletFailureMessage | null => {
  if (!isRequestId(value.id)) {
    return null;
  }

  const error = parseSerializedWalletApiError(value.error);
  if (!error) {
    return null;
  }

  return { type: "failure", id: value.id, error };
};

const parseWalletEvent = (value: MessageRecord): WalletEventMessage | null => {
  if (!isRecord(value.event)) {
    return null;
  }

  return { type: "event", event: value.event as WalletApiEvent };
};

export const parseWalletRequest = (value: unknown): WalletRequestMessage | null => {
  if (!isRecord(value) || value.type !== "request") {
    return null;
  }

  if (!isRequestId(value.id) || !isNonEmptyString(value.method)) {
    return null;
  }

  if (value.input === undefined) {
    return { type: "request", id: value.id, method: value.method };
  }

  return { type: "request", id: value.id, method: value.method, input: value.input };
};

export const parseWalletHostMessage = (value: unknown): WalletHostMessage | null => {
  if (!isRecord(value)) {
    return null;
  }

  switch (value.type) {
    case "success":
      return parseWalletSuccess(value);
    case "failure":
      return parseWalletFailure(value);
    case "event":
      return parseWalletEvent(value);
    default:
      return null;
  }
};
