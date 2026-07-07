import { eventTopic } from "../../../messenger/index.js";
import type { ProviderChainSelectionChangedPayload } from "./types.js";

export const PROVIDER_CHAIN_SELECTION_STORE_CHANGED = eventTopic<ProviderChainSelectionChangedPayload>(
  "store:providerChainSelection:changed",
);
