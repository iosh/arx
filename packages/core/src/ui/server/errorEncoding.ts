import { isArxBaseError, serializeArxError } from "../../error.js";
import { createRpcInternalErrorFromUnknown } from "../../rpc/errors.js";
import type { UiError } from "../protocol/envelopes.js";

export const encodeUiError = (error: unknown): UiError => {
  const domainError = isArxBaseError(error) ? error : createRpcInternalErrorFromUnknown(error);
  return serializeArxError(domainError);
};
