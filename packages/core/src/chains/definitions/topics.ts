import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { ChainDefinitionsState, ChainDefinitionsUpdate } from "./types.js";

export const CHAIN_DEFINITIONS_STATE_CHANGED = stateTopic<ChainDefinitionsState>("chainDefinitions:stateChanged");

export const CHAIN_DEFINITIONS_UPDATED = eventTopic<ChainDefinitionsUpdate>("chainDefinitions:updated");
