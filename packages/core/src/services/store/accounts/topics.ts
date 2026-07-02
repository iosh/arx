import { eventTopic } from "../../../messenger/index.js";
import type { AccountsChangedPayload } from "./types.js";

export const ACCOUNTS_STORE_CHANGED = eventTopic<AccountsChangedPayload>("store:accounts:changed");
