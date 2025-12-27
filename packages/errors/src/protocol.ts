import type { ArxError } from "./ArxError.js";
import type { ArxReason } from "./reasons.js";

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
  data?: unknown;
};

export type NamespaceProtocolAdapter = {
  encodeDappError(error: ArxError, ctx: ErrorEncodeContext): unknown;
  encodeUiError(error: ArxError, ctx: ErrorEncodeContext): UiErrorPayload;
};
