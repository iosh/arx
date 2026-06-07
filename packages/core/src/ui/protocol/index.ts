import type { z } from "zod";
import { uiEvents } from "./events.js";
import { uiMethods } from "./methods.js";
import type { UiEventPayloadMap, UiMethodResultMap } from "./results.js";

export const UiProtocol = {
  methods: uiMethods,
  events: uiEvents,
} as const;

export type UiMethodName = keyof typeof uiMethods;
export type UiEventName = keyof typeof uiEvents;

type UiMethodDef<N extends UiMethodName> = (typeof uiMethods)[N];

export type UiMethodParams<N extends UiMethodName> = z.infer<UiMethodDef<N>["paramsSchema"]>;
export type UiMethodResult<N extends UiMethodName> = UiMethodResultMap[N];
export type UiEventPayload<N extends UiEventName> = UiEventPayloadMap[N];

export const isUiMethodName = (value: unknown): value is UiMethodName =>
  typeof value === "string" && value in uiMethods;

export const isUiEventName = (value: unknown): value is UiEventName => typeof value === "string" && value in uiEvents;

export const parseUiMethodParams = <N extends UiMethodName>(method: N, params: unknown): UiMethodParams<N> => {
  return uiMethods[method].paramsSchema.parse(params) as UiMethodParams<N>;
};
