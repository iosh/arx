import { CHANNEL } from "./channel.js";
import type { ProviderRpcRequest, ProviderRpcResponse } from "./rpc.js";
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

export const isEnvelope = (value: unknown): value is Envelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { channel?: unknown; type?: unknown; sessionId?: unknown };
  return candidate.channel === CHANNEL && typeof candidate.type === "string" && typeof candidate.sessionId === "string";
};

export const deriveProtocolVersion = (value: unknown): ProtocolVersion | number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return PROTOCOL_VERSION;
};
