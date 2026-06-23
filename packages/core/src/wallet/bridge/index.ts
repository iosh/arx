export type {
  RemoteTrustedWalletClient,
  RemoteTrustedWalletClientOptions,
  WalletBridgeClientTransport,
} from "./client.js";
export {
  createRemoteTrustedWalletClient,
  WalletBridgeProtocolError,
  WalletBridgeRemoteError,
} from "./client.js";
export { encodeWalletBridgeError } from "./errorEncoding.js";
export type {
  WalletBridgeError,
  WalletBridgeMessage,
  WalletBridgeReply,
  WalletBridgeRequest,
  WalletBridgeResponse,
} from "./protocol.js";
export {
  parseWalletBridgeMessage,
  parseWalletBridgeRequest,
  WALLET_BRIDGE_PROTOCOL_VERSION,
} from "./protocol.js";
export type { WalletBridgeOperationExecutor, WalletBridgeServer } from "./server.js";
export { createWalletBridgeServer } from "./server.js";
