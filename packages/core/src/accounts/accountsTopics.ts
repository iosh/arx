import { eventTopic } from "../messenger/index.js";
import type { AccountsChangedPayload } from "./accountsTypes.js";

export const ACCOUNTS_STORE_CHANGED = eventTopic<AccountsChangedPayload>("store:accounts:changed");
