import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { OriginPermissions, PermissionsState } from "./types.js";

export const PERMISSION_STATE_CHANGED = stateTopic<PermissionsState>("permissions:stateChanged");

export const PERMISSION_ORIGIN_CHANGED = eventTopic<OriginPermissions>("permissions:originChanged");
