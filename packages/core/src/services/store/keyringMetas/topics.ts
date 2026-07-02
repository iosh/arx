import { eventTopic } from "../../../messenger/index.js";
import type { KeyringMetasChangedPayload } from "./types.js";

export const KEYRING_METAS_STORE_CHANGED = eventTopic<KeyringMetasChangedPayload>("store:keyringMetas:changed");
