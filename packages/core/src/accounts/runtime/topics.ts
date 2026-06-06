import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { stateTopic } from "../../messenger/topic.js";
import { isSameMultiNamespaceAccountsState } from "./state.js";
import type { MultiNamespaceAccountsState } from "./types.js";

export const ACCOUNTS_STATE_CHANGED = stateTopic<MultiNamespaceAccountsState>("accounts:stateChanged", {
  isEqual: (prev, next) => isSameMultiNamespaceAccountsState(prev, next),
});

export const ACCOUNTS_TOPICS = [ACCOUNTS_STATE_CHANGED] as const;

export type AccountMessenger = ScopedMessenger<typeof ACCOUNTS_TOPICS>;
