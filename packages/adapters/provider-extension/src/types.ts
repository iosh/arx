import type { TransportMeta, TransportRequest, TransportResponse } from "@arx/provider-core/types";
import type { CHANNEL } from "./constants.js";

export type HandshakeAckPayload = {
  chainId: string;
  caip2: string;
  accounts: string[];
  isUnlocked?: boolean;
  meta?: TransportMeta;
};

export type Envelope =
  | { channel: typeof CHANNEL; type: "handshake"; payload: { version: string } }
  | { channel: typeof CHANNEL; type: "handshake_ack"; payload: HandshakeAckPayload }
  | { channel: typeof CHANNEL; type: "request"; id: string; payload: TransportRequest }
  | { channel: typeof CHANNEL; type: "response"; id: string; payload: TransportResponse }
  | { channel: typeof CHANNEL; type: "event"; payload: { event: string; params?: unknown[] } };
