import type { UiMethodName } from "../protocol/index.js";
import { isUiMethodName } from "../protocol/index.js";
import type { UiMethodDefinition, UiMethodKind } from "../protocol/methods/types.js";
import { uiMethods } from "../protocol/methods.js";

export type UiRequestExecutionPlan = {
  kind: UiMethodKind;
};

export type UiDispatchRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export type UiRequestMetadata = {
  request: UiDispatchRequest;
  method: UiMethodName | null;
  plan: UiRequestExecutionPlan;
};

export const EMPTY_UI_REQUEST_EXECUTION_PLAN: UiRequestExecutionPlan = {
  kind: "query",
};

const buildUiRequestExecutionPlan = (definition: UiMethodDefinition): UiRequestExecutionPlan => ({
  kind: definition.kind,
});

const isUiDispatchRequest = (value: unknown): value is UiDispatchRequest => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; id?: unknown; method?: unknown };
  return candidate.type === "ui:request" && typeof candidate.id === "string" && typeof candidate.method === "string";
};

export const parseUiRequestMetadata = (raw: unknown): UiRequestMetadata | null => {
  if (!isUiDispatchRequest(raw)) return null;
  if (raw.id.length === 0) return null;

  if (!isUiMethodName(raw.method)) {
    return {
      request: raw,
      method: null,
      plan: EMPTY_UI_REQUEST_EXECUTION_PLAN,
    };
  }

  const method = raw.method as UiMethodName;
  const definition = uiMethods[method];
  return {
    request: raw,
    method,
    plan: buildUiRequestExecutionPlan(definition),
  };
};

export const getUiRequestExecutionPlan = (raw: unknown): UiRequestExecutionPlan | null => {
  const metadata = parseUiRequestMetadata(raw);
  return metadata?.method ? metadata.plan : null;
};
