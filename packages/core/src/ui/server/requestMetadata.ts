import type { UiMethodName } from "../protocol/index.js";
import { isUiMethodName } from "../protocol/index.js";
import { uiMethods } from "../protocol/methods.js";

export type UiDispatchEffects = {
  broadcastSnapshot: boolean;
  persistVaultMeta: boolean;
  holdBroadcast: boolean;
};

export type UiDispatchRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export type UiRequestMetadata = {
  request: UiDispatchRequest;
  method: UiMethodName | null;
  effects: UiDispatchEffects;
};

export const EMPTY_UI_DISPATCH_EFFECTS: UiDispatchEffects = {
  broadcastSnapshot: false,
  persistVaultMeta: false,
  holdBroadcast: false,
};

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
      effects: EMPTY_UI_DISPATCH_EFFECTS,
    };
  }

  const method = raw.method as UiMethodName;
  const definition = uiMethods[method];
  return {
    request: raw,
    method,
    effects: {
      broadcastSnapshot: definition.effects?.broadcastSnapshot ?? false,
      persistVaultMeta: definition.effects?.persistVaultMeta ?? false,
      holdBroadcast: definition.effects?.holdBroadcast ?? false,
    },
  };
};

export const getUiRequestEffects = (raw: unknown): UiDispatchEffects | null => {
  const metadata = parseUiRequestMetadata(raw);
  return metadata?.method ? metadata.effects : null;
};
