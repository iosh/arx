import type { TransportMeta, TransportRequest, TransportResponse } from "../types/transport.js";
import { CHANNEL } from "./channel.js";
import type { ProtocolVersion } from "./version.js";
import { PROTOCOL_VERSION } from "./version.js";

export type HandshakePayload = {
  protocolVersion?: ProtocolVersion | number;
  handshakeId: string;
};

export type HandshakeAckPayload = {
  protocolVersion?: ProtocolVersion | number;
  handshakeId: string;
  chainId: string;
  caip2: string;
  accounts: string[];
  isUnlocked: boolean;
  meta: TransportMeta;
};

export type Envelope =
  | { channel: typeof CHANNEL; sessionId: string; type: "handshake"; payload: HandshakePayload }
  | { channel: typeof CHANNEL; sessionId: string; type: "handshake_ack"; payload: HandshakeAckPayload }
  | { channel: typeof CHANNEL; sessionId: string; type: "request"; id: string; payload: TransportRequest }
  | { channel: typeof CHANNEL; sessionId: string; type: "response"; id: string; payload: TransportResponse }
  | { channel: typeof CHANNEL; sessionId: string; type: "event"; payload: { event: string; params?: unknown[] } };

export const isEnvelope = (value: unknown): value is Envelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { channel?: unknown; type?: unknown; sessionId?: unknown };
  return candidate.channel === CHANNEL && typeof candidate.type === "string" && typeof candidate.sessionId === "string";
};

export const deriveProtocolVersion = (value: unknown): ProtocolVersion | number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return PROTOCOL_VERSION;
};
