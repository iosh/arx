import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import { isSameSupportedChainsState } from "./state.js";
import type { SupportedChainsState, SupportedChainsUpdate } from "./types.js";

export const SUPPORTED_CHAINS_STATE_CHANGED = stateTopic<SupportedChainsState>("supportedChains:stateChanged", {
  isEqual: (prev, next) => isSameSupportedChainsState(prev, next),
});

export const SUPPORTED_CHAINS_UPDATED = eventTopic<SupportedChainsUpdate>("supportedChains:updated");

export const SUPPORTED_CHAINS_TOPICS = [SUPPORTED_CHAINS_STATE_CHANGED, SUPPORTED_CHAINS_UPDATED] as const;

export type SupportedChainsMessenger = ScopedMessenger<typeof SUPPORTED_CHAINS_TOPICS>;
