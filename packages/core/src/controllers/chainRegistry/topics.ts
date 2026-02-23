import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import { isSameChainRegistryState } from "./state.js";
import type { ChainRegistryState, ChainRegistryUpdate } from "./types.js";

export const CHAIN_REGISTRY_STATE_CHANGED = stateTopic<ChainRegistryState>("chainRegistry:stateChanged", {
  isEqual: (prev, next) => isSameChainRegistryState(prev, next),
});

export const CHAIN_REGISTRY_UPDATED = eventTopic<ChainRegistryUpdate>("chainRegistry:updated");

export const CHAIN_REGISTRY_TOPICS = [CHAIN_REGISTRY_STATE_CHANGED, CHAIN_REGISTRY_UPDATED] as const;

export type ChainRegistryMessenger = ScopedMessenger<typeof CHAIN_REGISTRY_TOPICS>;
