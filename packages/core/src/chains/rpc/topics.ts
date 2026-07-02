import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { ChainRpcEndpointsChangedEvent, ChainRpcState } from "./types.js";

export const CHAIN_RPC_STATE_CHANGED = stateTopic<ChainRpcState>("chainRpc:stateChanged");

export const CHAIN_RPC_ENDPOINTS_CHANGED = eventTopic<ChainRpcEndpointsChangedEvent>("chainRpc:endpointsChanged");
