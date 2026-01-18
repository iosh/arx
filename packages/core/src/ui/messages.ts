import type { UiErrorPayload } from "@arx/errors";
import { z } from "zod";
import { isUiEventName, isUiMethodName, type UiEventName, type UiMethodName } from "./protocol.js";
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

const UiContextSchema = z
  .object({
    namespace: z.string().min(1).optional(),
    chainRef: z.string().min(1).optional(),
  })
  .strict();

const UiErrorSchema = z
  .object({
    reason: z.string().min(1),
    message: z.string().min(1),
    data: z.unknown().optional(),
  })
  .strict();

const UiRequestEnvelopeSchema = z
  .object({
    type: z.literal("ui:request"),
    id: z.string().min(1),
    method: z.string().refine(isUiMethodName, { message: "Unknown UI method" }),
    params: z.unknown().optional(),
  })
  .strict();

const UiResponseEnvelopeSchema = z
  .object({
    type: z.literal("ui:response"),
    id: z.string().min(1),
    result: z.unknown(),
    context: UiContextSchema.optional(),
  })
  .strict();

const UiErrorEnvelopeSchema = z
  .object({
    type: z.literal("ui:error"),
    id: z.string().min(1),
    error: UiErrorSchema,
    context: UiContextSchema.optional(),
  })
  .strict();

const UiEventEnvelopeSchema = z
  .object({
    type: z.literal("ui:event"),
    event: z.string().refine(isUiEventName, { message: "Unknown UI event" }),
    payload: z.unknown(),
    context: UiContextSchema.optional(),
  })
  .strict();

const UiPortEnvelopeSchema = z.union([
  UiRequestEnvelopeSchema,
  UiResponseEnvelopeSchema,
  UiErrorEnvelopeSchema,
  UiEventEnvelopeSchema,
]);

export const parseUiEnvelope = (raw: unknown): UiPortEnvelope => {
  return UiPortEnvelopeSchema.parse(raw) as UiPortEnvelope;
};
