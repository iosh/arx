export type {
  RemoteTrustedWalletClient,
  RemoteTrustedWalletClientOptions,
  WalletBridgeClientTransport,
  WalletBridgeTransportErrorReason,
  WalletEventApi,
} from "./client.js";
export {
  createRemoteTrustedWalletClient,
  createWalletEventApi,
  WalletBridgeProtocolError,
  WalletBridgeRemoteError,
  WalletBridgeTransportError,
} from "./client.js";
export { encodeWalletBridgeError } from "./errorEncoding.js";
export type {
  WalletBridgeError,
  WalletBridgeEvent,
  WalletBridgeInvalidationEvent,
  WalletBridgeMessage,
  WalletBridgeReply,
  WalletBridgeRequest,
  WalletBridgeResponse,
  WalletInvalidationEvent,
  WalletInvalidationTopic,
} from "./protocol.js";
export {
  isWalletBridgeEventMessage,
  isWalletBridgeReplyMessage,
  isWalletBridgeRequestMessage,
  parseWalletBridgeEvent,
  parseWalletBridgeReply,
  parseWalletBridgeRequest,
  WALLET_BRIDGE_PROTOCOL_VERSION,
  WALLET_INVALIDATION_TOPICS,
} from "./protocol.js";
export type { WalletBridgeMethodExecutor, WalletBridgeServer } from "./server.js";
export { createWalletBridgeServer } from "./server.js";
