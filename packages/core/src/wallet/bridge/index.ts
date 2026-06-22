export { encodeWalletBridgeError } from "./errorEncoding.js";
export type {
  WalletBridgeEnvelope,
  WalletBridgeErrorEnvelope,
  WalletBridgeReplyEnvelope,
  WalletBridgeRequestEnvelope,
  WalletBridgeResponseEnvelope,
} from "./protocol.js";
export {
  parseWalletBridgeEnvelope,
  parseWalletBridgeRequestEnvelope,
  WALLET_BRIDGE_PROTOCOL_VERSION,
} from "./protocol.js";
export type { WalletBridgeOperationExecutor, WalletBridgeServer } from "./server.js";
export { createWalletBridgeServer } from "./server.js";
