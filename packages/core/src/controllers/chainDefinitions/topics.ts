import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import { isSameChainDefinitionsState } from "./state.js";
import type { ChainDefinitionsState, ChainDefinitionsUpdate } from "./types.js";

export const CHAIN_DEFINITIONS_STATE_CHANGED = stateTopic<ChainDefinitionsState>("chainDefinitions:stateChanged", {
  isEqual: (prev, next) => isSameChainDefinitionsState(prev, next),
});

export const CHAIN_DEFINITIONS_UPDATED = eventTopic<ChainDefinitionsUpdate>("chainDefinitions:updated");

export const CHAIN_DEFINITIONS_TOPICS = [CHAIN_DEFINITIONS_STATE_CHANGED, CHAIN_DEFINITIONS_UPDATED] as const;

export type ChainDefinitionsMessenger = ScopedMessenger<typeof CHAIN_DEFINITIONS_TOPICS>;
