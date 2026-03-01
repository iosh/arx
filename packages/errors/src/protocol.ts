import type { ArxError } from "./ArxError.js";
import type { JsonValue } from "./json.js";
import type { JsonRpcErrorObject } from "./jsonRpc.js";
import type { ArxReason } from "./spec.js";

export type ErrorSurface = "dapp" | "ui";

export type ErrorEncodeContext = {
  namespace: string;
  surface: ErrorSurface;
  chainRef?: string | null;
  origin?: string;
  method?: string;
};

export type UiErrorPayload = {
  reason: ArxReason;
  message: string;
  data?: JsonValue;
};

export type NamespaceProtocolAdapter = {
  encodeDappError(error: ArxError, ctx: ErrorEncodeContext): JsonRpcErrorObject;
  encodeUiError(error: ArxError, ctx: ErrorEncodeContext): UiErrorPayload;
};
