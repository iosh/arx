export type {
  RemoteTrustedWalletClient,
  RemoteTrustedWalletClientOptions,
  WalletBridgeClientTransport,
  WalletBridgeTransportErrorReason,
} from "./client.js";
export {
  createRemoteTrustedWalletClient,
  WalletBridgeProtocolError,
  WalletBridgeRemoteError,
  WalletBridgeTransportError,
} from "./client.js";
export { encodeWalletBridgeError } from "./errorEncoding.js";
export type {
  WalletBridgeError,
  WalletBridgeReply,
  WalletBridgeRequest,
  WalletBridgeResponse,
} from "./protocol.js";
export {
  isWalletBridgeReplyMessage,
  isWalletBridgeRequestMessage,
  parseWalletBridgeReply,
  parseWalletBridgeRequest,
  WALLET_BRIDGE_PROTOCOL_VERSION,
} from "./protocol.js";
export type { WalletBridgeMethodExecutor, WalletBridgeServer } from "./server.js";
export { createWalletBridgeServer } from "./server.js";
