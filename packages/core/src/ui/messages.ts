import type { UiErrorPayload } from "@arx/errors";
import type { UiEventName, UiMethodName } from "./protocol.js";

export const UI_CHANNEL = "arx:ui" as const;

export type UiContext = {
  namespace?: string;
  chainRef?: string;
};

export type UiError = {
  reason: UiErrorPayload["reason"];
  message: UiErrorPayload["message"];
  data?: UiErrorPayload["data"];
};

export type UiRequestEnvelope = {
  type: "ui:request";
  id: string;
  method: UiMethodName;
  params?: unknown;
};

export type UiResponseEnvelope = {
  type: "ui:response";
  id: string;
  result: unknown;
  context?: UiContext;
};

export type UiErrorEnvelope = {
  type: "ui:error";
  id: string;
  error: UiError;
  context?: UiContext;
};

export type UiEventEnvelope = {
  type: "ui:event";
  event: UiEventName;
  payload: unknown;
  context?: UiContext;
};

export type UiPortEnvelope = UiRequestEnvelope | UiResponseEnvelope | UiErrorEnvelope | UiEventEnvelope;
