import type { NamespaceAdapter } from "../adapter.js";
import { EIP155_NAMESPACE } from "../utils.js";
import { buildEip155Definitions } from "./definitions.js";
import { PASSTHROUGH_CONFIG } from "./passthrough.js";

export {
  EIP155_PASSTHROUGH_FILTER_METHODS,
  EIP155_PASSTHROUGH_READONLY_METHODS,
  PASSTHROUGH_CONFIG,
} from "./passthrough.js";

export const createEip155Adapter = (): NamespaceAdapter => ({
  namespace: EIP155_NAMESPACE,
  methodPrefixes: ["eth_", "personal_", "wallet_", "net_", "web3_"],
  definitions: buildEip155Definitions(),
  passthrough: PASSTHROUGH_CONFIG,
});
