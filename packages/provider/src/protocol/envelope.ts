import { CHANNEL } from "./channel.js";
import type { ProviderJsonValue, ProviderRpcRequest, ProviderRpcResponse } from "./rpc.js";
import type { ProtocolVersion } from "./version.js";
import { PROTOCOL_VERSION } from "./version.js";

export type HandshakePayload = {
  protocolVersion?: ProtocolVersion | number;
  handshakeId: string;
  namespace: string;
};

export type HandshakeAckPayload = {
  protocolVersion?: ProtocolVersion | number;
  handshakeId: string;
  state: unknown;
};

export type ProviderEventPayload = {
  event: string;
  params?: unknown[];
};

export type Envelope =
  | { channel: typeof CHANNEL; sessionId: string; type: "handshake"; payload: HandshakePayload }
  | { channel: typeof CHANNEL; sessionId: string; type: "handshake_ack"; payload: HandshakeAckPayload }
  | { channel: typeof CHANNEL; sessionId: string; type: "request"; id: string; payload: ProviderRpcRequest }
  | { channel: typeof CHANNEL; sessionId: string; type: "response"; id: string; payload: ProviderRpcResponse }
  | { channel: typeof CHANNEL; sessionId: string; type: "event"; payload: ProviderEventPayload };

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

const isPositiveInteger = (value: unknown): value is number => {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
};

const isJsonPrimitive = (value: unknown) => {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
};

const isJsonValue = (value: unknown, seen = new WeakSet<object>()): value is ProviderJsonValue => {
  if (isJsonPrimitive(value)) return typeof value !== "number" || Number.isFinite(value);
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
      if (!isJsonValue(value[index], seen)) return false;
    }
    return true;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((item) => item !== undefined && isJsonValue(item, seen));
};

const isProviderRpcParams = (value: unknown): value is NonNullable<ProviderRpcRequest["params"]> => {
  return (Array.isArray(value) || isRecord(value)) && isJsonValue(value);
};

const parseProtocolVersion = (value: unknown): ProtocolVersion | number | undefined => {
  if (value === undefined) return undefined;
  return isPositiveInteger(value) ? value : undefined;
};

const parseProviderRpcRequest = (value: unknown): ProviderRpcRequest | null => {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.method)) return null;
  if (value.params !== undefined && !isProviderRpcParams(value.params)) return null;

  return value.params === undefined
    ? {
        method: value.method,
      }
    : {
        method: value.method,
        params: value.params,
      };
};

const parseProviderRpcResponse = (value: unknown): ProviderRpcResponse | null => {
  if (!isRecord(value)) return null;

  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (hasResult === hasError) return null;

  if (hasResult) {
    if (!isJsonValue(value.result)) return null;
    return {
      result: value.result,
    };
  }

  if (!isRecord(value.error)) return null;
  const errorKind = value.error.kind;
  if (errorKind === "ArxError" && isNonEmptyString(value.error.code)) {
    return {
      error: {
        kind: "ArxError",
        code: value.error.code,
      },
    };
  }

  if (errorKind === "JsonRpcError" && typeof value.error.code === "number" && isNonEmptyString(value.error.message)) {
    const data = value.error.data;
    if (data !== undefined && !isJsonValue(data)) return null;
    return {
      error: {
        kind: "JsonRpcError",
        code: value.error.code,
        message: value.error.message,
        ...(data !== undefined ? { data } : {}),
      },
    };
  }

  return null;
};

const parseHandshakePayload = (value: unknown): HandshakePayload | null => {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.handshakeId)) return null;
  if (!isNonEmptyString(value.namespace)) return null;

  const protocolVersion = parseProtocolVersion(value.protocolVersion);
  if (value.protocolVersion !== undefined && protocolVersion === undefined) return null;

  return {
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
    handshakeId: value.handshakeId,
    namespace: value.namespace,
  };
};

const parseHandshakeAckPayload = (value: unknown): HandshakeAckPayload | null => {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.handshakeId)) return null;
  if (!Object.hasOwn(value, "state")) return null;

  const protocolVersion = parseProtocolVersion(value.protocolVersion);
  if (value.protocolVersion !== undefined && protocolVersion === undefined) return null;

  return {
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
    handshakeId: value.handshakeId,
    state: value.state,
  };
};

const parseProviderEventPayload = (value: unknown): ProviderEventPayload | null => {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.event)) return null;
  if (value.params !== undefined && !Array.isArray(value.params)) return null;

  return {
    event: value.event,
    ...(value.params !== undefined ? { params: value.params } : {}),
  };
};

export const parseProviderEnvelope = (value: unknown): Envelope | null => {
  if (!isRecord(value)) return null;
  if (value.channel !== CHANNEL) return null;
  if (!isNonEmptyString(value.sessionId)) return null;

  switch (value.type) {
    case "handshake": {
      const payload = parseHandshakePayload(value.payload);
      if (!payload) return null;
      return { channel: CHANNEL, sessionId: value.sessionId, type: "handshake", payload };
    }

    case "handshake_ack": {
      const payload = parseHandshakeAckPayload(value.payload);
      if (!payload) return null;
      return { channel: CHANNEL, sessionId: value.sessionId, type: "handshake_ack", payload };
    }

    case "request": {
      if (!isNonEmptyString(value.id)) return null;
      const payload = parseProviderRpcRequest(value.payload);
      if (!payload) return null;
      return { channel: CHANNEL, sessionId: value.sessionId, type: "request", id: value.id, payload };
    }

    case "response": {
      if (!isNonEmptyString(value.id)) return null;
      const payload = parseProviderRpcResponse(value.payload);
      if (!payload) return null;
      return { channel: CHANNEL, sessionId: value.sessionId, type: "response", id: value.id, payload };
    }

    case "event": {
      const payload = parseProviderEventPayload(value.payload);
      if (!payload) return null;
      return { channel: CHANNEL, sessionId: value.sessionId, type: "event", payload };
    }

    default:
      return null;
  }
};

export const deriveProtocolVersion = (value: unknown): ProtocolVersion | number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return PROTOCOL_VERSION;
};
