import type { ArxError } from "./ArxError.js";
import { getGenericSurfaceErrorDefaults } from "./defaults.js";
import { toJsonSafe } from "./json.js";
import type { JsonRpcErrorObject } from "./jsonRpc.js";
import type { ErrorEncodeContext, UiErrorPayload } from "./protocol.js";
import type { ArxReason } from "./reasons.js";

export type DappErrorOverrides = Partial<
  Record<
    ArxReason,
    {
      code?: number;
      message?: string;
    }
  >
>;

export const sanitizeJsonRpcErrorObject = (error: {
  code: number;
  message?: unknown;
  data?: unknown;
}): JsonRpcErrorObject => {
  const data = toJsonSafe(error.data);

  return {
    code: error.code,
    message: typeof error.message === "string" && error.message.length > 0 ? error.message : "Unknown error",
    ...(data !== undefined ? { data } : {}),
  };
};

export const encodeDappError = (
  error: ArxError,
  _ctx: ErrorEncodeContext,
  overrides?: DappErrorOverrides,
): JsonRpcErrorObject => {
  const defaults = getGenericSurfaceErrorDefaults(error.reason);
  const patch = overrides?.[error.reason];
  const code = patch?.code ?? defaults.dapp.code;
  const message = patch?.message ?? defaults.dapp.message;

  const data =
    defaults.exposure === "ui_and_dapp"
      ? // Best-effort: dApp must never receive non-serializable payloads.
        toJsonSafe(error.data)
      : undefined;

  return {
    code,
    message,
    ...(data !== undefined ? { data } : {}),
  };
};

export const encodeUiError = (error: ArxError, _ctx: ErrorEncodeContext): UiErrorPayload => {
  const defaults = getGenericSurfaceErrorDefaults(error.reason);
  const data = toJsonSafe(error.data);
  return {
    reason: error.reason,
    // UI can safely prefer the domain message; fallback keeps UIs stable.
    message: error.message || defaults.ui.message,
    ...(data !== undefined ? { data } : {}),
  };
};
