import type { ArxError } from "./ArxError.js";
import { toJsonSafe } from "./json.js";
import type { JsonRpcErrorObject } from "./jsonRpc.js";
import type { ErrorEncodeContext, UiErrorPayload } from "./protocol.js";
import type { ArxReason } from "./spec.js";
import { ArxErrorSpec } from "./spec.js";

const getSpec = (reason: ArxReason) => ArxErrorSpec[reason];

export type DappErrorOverrides = Partial<
  Record<
    ArxReason,
    {
      code?: number;
      message?: string;
    }
  >
>;

export const encodeDappError = (
  error: ArxError,
  _ctx: ErrorEncodeContext,
  overrides?: DappErrorOverrides,
): JsonRpcErrorObject => {
  const spec = getSpec(error.reason);
  const patch = overrides?.[error.reason];
  const code = patch?.code ?? spec.dapp.code;
  const message =
    patch?.message ?? (spec.exposure === "ui_and_dapp" && error.message.length > 0 ? error.message : spec.dapp.message);

  const data =
    spec.exposure === "ui_and_dapp"
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
  const spec = getSpec(error.reason);
  const data = toJsonSafe(error.data);
  return {
    reason: error.reason,
    // UI can safely prefer the domain message; fallback keeps UIs stable.
    message: error.message || spec.ui.message,
    ...(data !== undefined ? { data } : {}),
  };
};
