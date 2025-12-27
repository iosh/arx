import {
  type ArxError,
  ArxReasons,
  type ErrorEncodeContext,
  type NamespaceProtocolAdapter,
  type UiErrorPayload,
} from "@arx/errors";
import type { Json, JsonRpcError } from "@metamask/utils";

const toJsonSafe = (value: unknown): Json | undefined => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch {
    return undefined;
  }
};

const buildDappData = (error: ArxError): Record<string, Json> | undefined => {
  const safe = toJsonSafe(error.data);

  if (safe && typeof safe === "object" && !Array.isArray(safe)) {
    return safe as Record<string, Json>;
  }

  return undefined;
};

const buildJsonRpcError = (code: number, error: ArxError): JsonRpcError => {
  const data = buildDappData(error);
  return {
    code,
    message: error.message || "Unknown error",
    ...(data ? { data } : {}),
  };
};

const toUiPayload = (error: ArxError): UiErrorPayload => {
  const safe = toJsonSafe(error.data);
  return {
    reason: error.reason,
    message: error.message,
    ...(safe !== undefined ? { data: safe } : {}),
  };
};

export const createEip155ProtocolAdapter = (): NamespaceProtocolAdapter => ({
  encodeDappError(error, _ctx: ErrorEncodeContext) {
    switch (error.reason) {
      case ArxReasons.VaultLocked:
      case ArxReasons.SessionLocked:
      case ArxReasons.PermissionNotConnected:
        return buildJsonRpcError(4100, error);

      case ArxReasons.PermissionDenied:
      case ArxReasons.ApprovalRejected:
        return buildJsonRpcError(4001, error);

      case ArxReasons.RpcInvalidParams:
        return buildJsonRpcError(-32602, error);

      case ArxReasons.RpcMethodNotFound:
        return buildJsonRpcError(-32601, error);

      case ArxReasons.RpcInternal:
        return buildJsonRpcError(-32603, error);

      default:
        return buildJsonRpcError(-32603, error);
    }
  },

  encodeUiError(error, _ctx: ErrorEncodeContext) {
    return toUiPayload(error);
  },
});
