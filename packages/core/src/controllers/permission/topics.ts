import type { ScopedMessenger } from "../../messenger/Messenger.js";
import { eventTopic, stateTopic } from "../../messenger/topic.js";
import type { OriginPermissions, PermissionsState } from "./types.js";

export const PERMISSION_STATE_CHANGED = stateTopic<PermissionsState>("permission:stateChanged");

export const PERMISSION_ORIGIN_CHANGED = eventTopic<OriginPermissions>("permission:originChanged");

export const PERMISSION_TOPICS = [PERMISSION_STATE_CHANGED, PERMISSION_ORIGIN_CHANGED] as const;

export type PermissionMessenger = ScopedMessenger<typeof PERMISSION_TOPICS>;
