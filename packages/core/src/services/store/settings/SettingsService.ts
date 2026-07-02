import type { Messenger } from "../../../messenger/index.js";
import type { SettingsRecord } from "../../../storage/records.js";
import { createSerialQueue } from "../_shared/serialQueue.js";
import type { SettingsPort } from "./port.js";
import { SETTINGS_STORE_CHANGED } from "./topics.js";
import type { SettingsService, UpdateSettingsParams } from "./types.js";

export type CreateSettingsServiceOptions = {
  messenger: Messenger;
  port: SettingsPort;
  now?: () => number;
};

const areStringRecordsEqual = (left: Record<string, string>, right: Record<string, string>): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
};

export const createSettingsService = ({ messenger, port, now }: CreateSettingsServiceOptions): SettingsService => {
  const clock = now ?? Date.now;
  const run = createSerialQueue();

  const get = async (): Promise<SettingsRecord | null> => {
    return await port.get();
  };

  const update = async (params: UpdateSettingsParams): Promise<SettingsRecord> => {
    return await run(async () => {
      const current = await port.get();

      const selectedAccountKeysByNamespace: Record<string, string> = {
        ...(current?.selectedAccountKeysByNamespace ?? {}),
      };

      if (params.selectedAccountKeysByNamespace) {
        for (const [namespace, accountKey] of Object.entries(params.selectedAccountKeysByNamespace)) {
          const ns = namespace.trim();
          if (!ns) continue;
          if (!accountKey) {
            delete selectedAccountKeysByNamespace[ns];
            continue;
          }
          selectedAccountKeysByNamespace[ns] = accountKey;
        }
      }

      if (
        current &&
        areStringRecordsEqual(current.selectedAccountKeysByNamespace ?? {}, selectedAccountKeysByNamespace)
      ) {
        return current;
      }

      const next: SettingsRecord = {
        id: "settings",
        ...(Object.keys(selectedAccountKeysByNamespace).length > 0 ? { selectedAccountKeysByNamespace } : {}),
        updatedAt: clock(),
      };

      await port.put(next);
      messenger.publish(SETTINGS_STORE_CHANGED, { next });
      return next;
    });
  };

  return {
    subscribeChanged: (handler) => messenger.subscribe(SETTINGS_STORE_CHANGED, handler),

    get,
    update,
  };
};
