import { eventTopic } from "../../../messenger/index.js";
import type { ChainRpcEndpointOverridesChangedPayload } from "./types.js";

export const CHAIN_RPC_ENDPOINT_OVERRIDES_STORE_CHANGED = eventTopic<ChainRpcEndpointOverridesChangedPayload>(
  "store:chainRpcEndpointOverrides:changed",
);
