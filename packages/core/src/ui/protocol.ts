import type { z } from "zod";
import { uiEvents } from "./events.js";
import { uiMethods } from "./methods.js";

export const UiProtocol = {
  methods: uiMethods,
  events: uiEvents,
} as const;

export type UiMethodName = keyof typeof uiMethods;
export type UiEventName = keyof typeof uiEvents;

type UiMethodDef<N extends UiMethodName> = (typeof uiMethods)[N];
type UiEventDef<N extends UiEventName> = (typeof uiEvents)[N];

export type UiMethodParams<N extends UiMethodName> = z.infer<UiMethodDef<N>["paramsSchema"]>;
export type UiMethodResult<N extends UiMethodName> = z.infer<UiMethodDef<N>["resultSchema"]>;
export type UiEventPayload<N extends UiEventName> = z.infer<UiEventDef<N>["payloadSchema"]>;

export const isUiMethodName = (value: unknown): value is UiMethodName =>
  typeof value === "string" && value in uiMethods;

export const isUiEventName = (value: unknown): value is UiEventName => typeof value === "string" && value in uiEvents;

export const parseUiMethodParams = <N extends UiMethodName>(method: N, params: unknown): UiMethodParams<N> => {
  return uiMethods[method].paramsSchema.parse(params) as UiMethodParams<N>;
};

export const parseUiMethodResult = <N extends UiMethodName>(method: N, result: unknown): UiMethodResult<N> => {
  return uiMethods[method].resultSchema.parse(result) as UiMethodResult<N>;
};

export const parseUiEventPayload = <N extends UiEventName>(event: N, payload: unknown): UiEventPayload<N> => {
  return uiEvents[event].payloadSchema.parse(payload) as UiEventPayload<N>;
};
