import { isArxBaseError, type SerializedArxError, serializeArxError } from "../../error.js";
import { createRpcInternalErrorFromUnknown } from "../../rpc/errors.js";

export const encodeWalletBridgeError = (error: unknown): SerializedArxError => {
  const domainError = isArxBaseError(error) ? error : createRpcInternalErrorFromUnknown(error);
  return serializeArxError(domainError);
};
