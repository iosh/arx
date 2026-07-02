import { stateTopic } from "../../messenger/topic.js";
import type { MultiNamespaceAccountsState } from "./types.js";

export const ACCOUNTS_STATE_CHANGED = stateTopic<MultiNamespaceAccountsState>("accounts:stateChanged");
