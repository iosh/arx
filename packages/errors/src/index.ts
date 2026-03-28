export type { ArxErrorInput, ArxErrorJson } from "./ArxError.js";
export { ArxError, arxError, coerceArxError, isArxError, isArxErrorLike } from "./ArxError.js";
export { encodeDappError, encodeUiError, sanitizeJsonRpcErrorObject } from "./encode.js";
export type { JsonRpcErrorObject } from "./jsonRpc.js";
export type { ErrorEncodeContext, ErrorSurface, NamespaceProtocolAdapter, UiErrorPayload } from "./protocol.js";
export type { ArxReason } from "./reasons.js";
export { ArxReasons, isArxReason } from "./reasons.js";
