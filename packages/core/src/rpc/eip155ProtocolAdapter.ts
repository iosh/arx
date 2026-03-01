import {
  type ArxError,
  type ErrorEncodeContext,
  type NamespaceProtocolAdapter,
  type UiErrorPayload,
} from "@arx/errors";
import { encodeDappError, encodeUiError } from "@arx/errors";

export const createEip155ProtocolAdapter = (): NamespaceProtocolAdapter => ({
  encodeDappError(error, _ctx: ErrorEncodeContext) {
    return encodeDappError(error, _ctx);
  },

  encodeUiError(error, _ctx: ErrorEncodeContext) {
    return encodeUiError(error, _ctx) satisfies UiErrorPayload;
  },
});
