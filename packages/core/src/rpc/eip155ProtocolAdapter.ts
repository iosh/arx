import { ArxReasons, type ErrorEncodeContext, encodeDappError, type NamespaceProtocolAdapter } from "@arx/errors";

export const createEip155ProtocolAdapter = (): NamespaceProtocolAdapter => ({
  encodeDappError(error, _ctx: ErrorEncodeContext) {
    return encodeDappError(error, _ctx, {
      [ArxReasons.ChainNotFound]: {
        code: 4902,
        message: "Unrecognized chain",
      },
      [ArxReasons.ChainNotCompatible]: {
        code: 4902,
        message: "Unrecognized chain",
      },
      [ArxReasons.ChainNotSupported]: {
        code: 4902,
        message: "Unrecognized chain",
      },
    });
  },
});
