import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { ChainRpcEndpointsChangedEvent, ChainRpcState } from "./types.js";

export const CHAIN_RPC_STATE_CHANGED = stateTopic<ChainRpcState>("chainRpc:stateChanged");

export const CHAIN_RPC_ENDPOINTS_CHANGED = eventTopic<ChainRpcEndpointsChangedEvent>("chainRpc:endpointsChanged");

export const CHAIN_RPC_TOPICS = [CHAIN_RPC_STATE_CHANGED, CHAIN_RPC_ENDPOINTS_CHANGED] as const;

export type ChainRpcMessenger = ScopedMessenger<typeof CHAIN_RPC_TOPICS>;
