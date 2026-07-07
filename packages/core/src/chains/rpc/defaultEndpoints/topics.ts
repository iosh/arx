import { eventTopic } from "../../../messenger/index.js";
import type { ChainRpcDefaultEndpointsChangedPayload } from "./types.js";

export const CHAIN_RPC_DEFAULT_ENDPOINTS_STORE_CHANGED = eventTopic<ChainRpcDefaultEndpointsChangedPayload>(
  "store:chainRpcDefaultEndpoints:changed",
);
