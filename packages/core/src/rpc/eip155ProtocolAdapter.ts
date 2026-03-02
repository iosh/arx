import {
  type ErrorEncodeContext,
  encodeDappError,
  encodeUiError,
  type NamespaceProtocolAdapter,
  type UiErrorPayload,
} from "@arx/errors";

export const createEip155ProtocolAdapter = (): NamespaceProtocolAdapter => ({
  encodeDappError(error, _ctx: ErrorEncodeContext) {
    return encodeDappError(error, _ctx);
  },

  encodeUiError(error, _ctx: ErrorEncodeContext) {
    return encodeUiError(error, _ctx) satisfies UiErrorPayload;
  },
});
