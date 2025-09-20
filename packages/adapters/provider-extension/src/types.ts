import type { JsonRpcRequest, JsonRpcResponse } from "@arx/provider-core/types";
import type { CHANNEL } from "./constants.js";

export type HandshakeAckPayload = {
  chainId: string;
  caip2: string;
  accounts: string[];
  isUnlocked?: boolean;
};

export type Envelope =
  | { channel: typeof CHANNEL; type: "handshake"; payload: { version: string } }
  | { channel: typeof CHANNEL; type: "handshake_ack"; payload: HandshakeAckPayload }
  | { channel: typeof CHANNEL; type: "request"; id: string; payload: JsonRpcRequest }
  | { channel: typeof CHANNEL; type: "response"; id: string; payload: JsonRpcResponse }
  | { channel: typeof CHANNEL; type: "event"; payload: { event: string; params?: unknown[] } };
